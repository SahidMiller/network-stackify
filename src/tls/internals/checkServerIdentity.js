import { errors } from "@network-stackify/stack/utils";
const { ERR_TLS_CERT_ALTNAME_INVALID } = errors.codes;

function unfqdn(host) {
  return String.prototype.replace.call(host, /[.]$/, "");
}

// String#toLowerCase() is locale-sensitive so we use
// a conservative version that only lowercases A-Z.
function toLowerCase(c) {
  return String.fromCharCode(32 + String.prototype.charCodeAt.call(c, 0));
}

function splitHost(host) {
  return String.prototype.split.call(
    String.prototype.replace.call(unfqdn(host), /[A-Z]/g, toLowerCase),
    "."
  );
}

function check(hostParts, pattern, wildcards) {
  // Empty strings, null, undefined, etc. never match.
  if (!pattern) return false;

  const patternParts = splitHost(pattern);

  if (hostParts.length !== patternParts.length) return false;

  // Pattern has empty components, e.g. "bad..example.com".
  if (Array.prototype.includes.call(patternParts, "")) return false;

  // RFC 6125 allows IDNA U-labels (Unicode) in names but we have no
  // good way to detect their encoding or normalize them so we simply
  // reject them.  Control characters and blanks are rejected as well
  // because nothing good can come from accepting them.
  const isBad = (s) => /[^\u0021-\u007F]/u.test(s);
  if (Array.prototype.some.call(patternParts, isBad)) return false;

  // Check host parts from right to left first.
  for (let i = hostParts.length - 1; i > 0; i -= 1) {
    if (hostParts[i] !== patternParts[i]) return false;
  }

  const hostSubdomain = hostParts[0];
  const patternSubdomain = patternParts[0];
  const patternSubdomainParts = String.prototype.split.call(
    patternSubdomain,
    "*"
  );

  // Short-circuit when the subdomain does not contain a wildcard.
  // RFC 6125 does not allow wildcard substitution for components
  // containing IDNA A-labels (Punycode) so match those verbatim.
  if (
    patternSubdomainParts.length === 1 ||
    String.prototype.includes.call(patternSubdomain, "xn--")
  )
    return hostSubdomain === patternSubdomain;

  if (!wildcards) return false;

  // More than one wildcard is always wrong.
  if (patternSubdomainParts.length > 2) return false;

  // *.tld wildcards are not allowed.
  if (patternParts.length <= 2) return false;

  const { 0: prefix, 1: suffix } = patternSubdomainParts;

  if (prefix.length + suffix.length > hostSubdomain.length) return false;

  if (!String.prototype.startsWith.call(hostSubdomain, prefix)) return false;

  if (!String.prototype.endsWith.call(hostSubdomain, suffix)) return false;

  return true;
}

export function checkServerIdentity(hostname, subject, altNames, cert) {
  const dnsNames = [];
  const uriNames = [];
  const ips = [];

  hostname = "" + hostname;

  if (altNames && altNames instanceof Array) {
    altNames.forEach((altName = {}) => {
      const type = altName.type;
      const value = altName.value;

      if (type === 2) {
        dnsNames.push(value);
      } else if (type === 6) {
        uriNames.push(value);
      } else if (type === 7) {
        ips.push(value);
      }
    });
  } else {
    altNames = [];
  }

  let valid = false;
  let reason = "Unknown reason";

  const hasAltNames = altNames.length >= 1;

  hostname = unfqdn(hostname); // Remove trailing dot for error messages.

  if (hasAltNames || subject) {
    const hostParts = splitHost(hostname);
    const wildcard = (pattern) => check(hostParts, pattern, true);

    if (hasAltNames) {
      const noWildcard = (pattern) => check(hostParts, pattern, false);
      valid =
        Array.prototype.some.call(dnsNames, wildcard) ||
        Array.prototype.some.call(uriNames, noWildcard);
      if (!valid)
        reason = `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
    } else {
      // Match against Common Name only if no supported identifiers exist.
      const cn = subject.CN;

      if (Array.isArray(cn)) valid = Array.prototype.some.call(cn, wildcard);
      else if (cn) valid = wildcard(cn);

      if (!valid) reason = `Host: ${hostname}. is not cert's CN: ${cn}`;
    }
  } else {
    reason = "Cert is empty";
  }

  if (!valid) {
    return new ERR_TLS_CERT_ALTNAME_INVALID(reason, hostname, cert);
  }

  return valid;
}
