const { Socket, _normalizeArgs } = require("net");
const util = require("util");
const Stream = require("stream");
const forge = require("node-forge");

const { ERR_TLS_CERT_ALTNAME_INVALID } = require("../utils").errors.codes;

// Compatibility shim for the browser
if (forge.forge) {
  forge = forge.forge;
}

class TLSSocket extends Stream.Duplex {
  constructor(socket, options) {
    //Wrap socket with TLS commands, God willing.
    //Create new socket if none passed, God willing.
    super();

    this._options = options;
    this._secureEstablished = false;
    this._chunks = [];

    // Just a documented property to make secure sockets
    // distinguishable from regular ones.
    this.encrypted = true;

    this.initSocket(socket);
  }

  log(...args) {
    if (this._options.debug) {
      console.log.apply(console, Array.prototype.slice.call(args));
    }
  }

  _read() {}

  setTimeout() {}
  setNoDelay() {}

  createCaStore() {
    const rootCertificates =
      this._options.rootCertificates || exports.rootCertificates;
    const caStore = forge.pki.createCaStore([]);

    for (let i = 0; i < rootCertificates.length; i++) {
      const rootCertificate = rootCertificates[i];
      try {
        caStore.addCertificate(rootCertificate);
      } catch (err) {}
    }

    return caStore;
  }

  init() {
    const self = this;
    const options = this._options;
    const rootCertificates = options.rootCertificates || [];

    //If no root certificates but no cert or rejectUnauthorized is true, then stop.
    if (
      !rootCertificates.length &&
      !options.servername &&
      !options.rejectUnauthorized
    ) {
      throw new Error(
        "Cannot verify nor skip verification. Provide options.rootCertificates or set options.rejectUnauthorized to false"
      );
    }

    const caStore = this.createCaStore();

    this.ssl = forge.tls.createConnection({
      server: false,
      caStore: caStore,
      verify: function (connection, verified, depth, certs) {
        const currentCert = certs[depth];

        if (!options.rejectUnauthorized || !options.servername) {
          self.log("[tls] server certificate verification skipped");
          return true;
        }

        if (depth === 0) {
          const cn = currentCert.subject.getField("CN").value;
          const subjectAltNames = currentCert.getExtension("subjectAltName");

          if (
            !exports.checkServerIdentity(
              options.servername,
              cn,
              subjectAltNames && subjectAltNames.altNames,
              currentCert
            )
          ) {
            verified = {
              alert: forge.tls.Alert.Description.bad_certificate,
              message: "Certificate common name does not match hostname.",
            };
            console.warn("[tls] " + cn + " !== " + options.servername);
          }

          try {
            if (forge.pki.verifyCertificateChain(caStore, certs)) {
              caStore.addCertificate(currentCert);
            } else {
              self.log("[tls] failed to verify certificate chain");
              return false;
            }
          } catch (err) {
            self.log("[tls] failed to verify certificate chain");
            return false;
          }

          self.log("[tls] server certificate verified");
        }

        return verified;
      },
      connected: function (connection) {
        self.log("[tls] connected");

        self._secureEstablished = true;
        self._writePending();
        self.emit("secure");
      },
      tlsDataReady: function (connection) {
        // encrypted data is ready to be sent to the server
        var data = connection.tlsData.getBytes();

        self.log(`[tls] sending ${data.length} bytes:
          ${Buffer.from(data, "binary").toString("hex")}
          [tls] sending finished
        `);

        self._socket.write(data, "binary"); // encoding should be 'binary'
      },
      dataReady: function (connection) {
        // clear data from the server is ready
        var data = connection.data.getBytes(),
          buffer = Buffer.from(data, "binary");

        self.log(`[tls] receiving ${data.length} bytes: 
        ${data}
        [tls] recieve finished
        `);
        //Publish to readers of TLSSocket
        self.push(buffer);
      },
      closed: function () {
        self.log("[tls] disconnected");
        self.end();
      },
      error: function (connection, error) {
        self.log("[tls] error", error);
        error.toString = function () {
          return "TLS error: " + error.message;
        };
        self.emit("error", error);
      },
    });

    this._socket.on("data", (data) => {
      self.log(
        "[tls] recieved from socket:",
        Buffer.from(data, "binary").toString("hex")
      );

      //Shows up after recieved
      self.ssl.process(data.toString("binary")); // encoding should be 'binary'
    });

    this.log("[tls] handshaking");
    this.ssl.handshake();
  }

  _writenow(data, encoding, cb) {
    cb = cb || function () {};

    this.log("[tls] sending: ", data.toString("utf8"));
    var result = this.ssl.prepare(data.toString("binary"));

    process.nextTick(function () {
      var err =
        result !== false
          ? null
          : "Error while packaging data into a TLS record";
      cb(err);
    });
  }

  _writePending() {
    if (this._chunks.length > 0) {
      for (var i in this._chunks) {
        this._writenow(
          this._chunks[i][0],
          this._chunks[i][1],
          this._chunks[i][2]
        );
      }
      this._chunks = [];
    }
  }

  _write(data, encoding, cb) {
    if (!this._secureEstablished) {
      this._chunks.push([data, encoding, cb]);
    } else {
      this._writePending();
      this._writenow(data, encoding, cb);
    }
  }

  get _connecting() {
    return this._socket && this._socket.connecting;
  }

  onConnect() {
    this.init();
    this.emit("connect");
  }

  initSocket(socket) {
    if (!socket) return;

    this._socket = socket;

    if (this._socket.connecting || this._socket.readyState !== "open") {
      this._socket.once("connect", this.onConnect.bind(this));
    } else {
      this.onConnect();
    }

    this._socket.once("close", (hadError) => this.emit("close", hadError));
    return this;
  }

  connect(...args) {
    return this.initSocket(new Socket().connect(...args));
  }
}

function isObject(val) {
  return val !== null && typeof val === "object";
}

function normalizeConnectArgs(listArgs) {
  var args = _normalizeArgs(listArgs);
  var options = args[0];
  var cb = args[1];
  if (isObject(listArgs[1])) {
    options = util._extend(options, listArgs[1]);
  } else if (isObject(listArgs[2])) {
    options = util._extend(options, listArgs[2]);
  }
  return cb ? [options, cb] : [options];
}

function onConnectSecure() {
  this.emit("secureConnect");
}

exports.connect = function (...args) {
  var args = normalizeConnectArgs(args);
  var options = args[0];
  var cb = args[1];

  var defaults = {
    rejectUnauthorized: "0" !== process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    ciphers: null, //tls.DEFAULT_CIPHERS
  };

  options = util._extend(defaults, options || {});

  var socket = new TLSSocket(options.socket, {
    ...options,
    servername: options.host,
    rejectUnauthorized: options.rejectUnauthorized,
    rootCertificates: options.rootCertificates,
  });

  socket.once("secure", onConnectSecure);
  if (cb) socket.once("secureConnect", cb);

  if (!options.socket) {
    socket.connect(options);
  }

  return socket;
};

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

exports.checkServerIdentity = function checkServerIdentity(
  hostname,
  subject,
  altNames,
  cert
) {
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
};

exports.rootCertificates = require("./rootCertificates");
