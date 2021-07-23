// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

import EE from "events";
import { Server as _Server } from "net";

import { debuglog } from "util"
let debug = debuglog("tls", (fn) => {
  debug = fn;
});

import { TLSSocket } from "./socket.js";
import { connResetException, codes } from "@network-stackify/stack/utils/errors.js";
const { ERR_INVALID_ARG_TYPE } = codes;
import { validateNumber } from "@network-stackify/stack/utils/validators.js";

const kErrorEmitted = Symbol("error-emitted");
const kHandshakeTimeout = Symbol("handshake-timeout");

function onServerSocketSecure() {
  if (!this.destroyed) {
    debug("server emit secureConnection");
    this.secureConnecting = false;
    this._options.server.emit("secureConnection", this);
  }
}

function onSocketTLSError(err) {
  if (!this._controlReleased && !this[kErrorEmitted]) {
    this[kErrorEmitted] = true;
    debug("server emit tlsClientError:", err);
    this._options.server.emit("tlsClientError", err, this);
  }
}

function onSocketClose(err) {
  // Closed because of error - no need to emit it twice
  if (err) return;

  // Emit ECONNRESET
  if (!this._controlReleased && !this[kErrorEmitted]) {
    this[kErrorEmitted] = true;
    const connReset = connResetException("socket hang up");
    this._options.server.emit("tlsClientError", connReset, this);
  }
}

function tlsConnectionListener(rawSocket) {
  debug("net.Server.on(connection): new TLSSocket");
  const socket = new TLSSocket(rawSocket, {
    isServer: true,
    server: this,
    cert: this._options.cert,
    key: this._options.key,
    requestCert: this.requestCert,
    rejectUnauthorized: this.rejectUnauthorized,
    handshakeTimeout: this[kHandshakeTimeout],
    pauseOnConnect: this.pauseOnConnect,
  });

  socket.on("secure", onServerSocketSecure);

  socket[kErrorEmitted] = false;
  socket.on("close", onSocketClose);
  socket.on("_tlsError", onSocketTLSError);
}

// AUTHENTICATION MODES
//
// There are several levels of authentication that TLS/SSL supports.
// Read more about this in "man SSL_set_verify".
//
// 1. The server sends a certificate to the client but does not request a
// cert from the client. This is common for most HTTPS servers. The browser
// can verify the identity of the server, but the server does not know who
// the client is. Authenticating the client is usually done over HTTP using
// login boxes and cookies and stuff.
//
// 2. The server sends a cert to the client and requests that the client
// also send it a cert. The client knows who the server is and the server is
// requesting the client also identify themselves. There are several
// outcomes:
//
//   A) verifyError returns null meaning the client's certificate is signed
//   by one of the server's CAs. The server now knows the client's identity
//   and the client is authorized.
//
//   B) For some reason the client's certificate is not acceptable -
//   verifyError returns a string indicating the problem. The server can
//   either (i) reject the client or (ii) allow the client to connect as an
//   unauthorized connection.
//
// The mode is controlled by two boolean variables.
//
// requestCert
//   If true the server requests a certificate from client connections. For
//   the common HTTPS case, users will want this to be false, which is what
//   it defaults to.
//
// rejectUnauthorized
//   If true clients whose certificates are invalid for any reason will not
//   be allowed to make connections. If false, they will simply be marked as
//   unauthorized but secure communication will continue. By default this is
//   true.
//
//
//
// Options:
// - requestCert. Send verify request. Default to false.
// - rejectUnauthorized. Boolean, default to true.
// - key. string.
// - cert: string.
// - clientCertEngine: string.
// - ca: string or array of strings.
// - sessionTimeout: integer.
//
// emit 'secureConnection'
//   function (tlsSocket) { }
//
//   "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_CRL",
//   "UNABLE_TO_DECRYPT_CERT_SIGNATURE", "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
//   "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY", "CERT_SIGNATURE_FAILURE",
//   "CRL_SIGNATURE_FAILURE", "CERT_NOT_YET_VALID" "CERT_HAS_EXPIRED",
//   "CRL_NOT_YET_VALID", "CRL_HAS_EXPIRED" "ERROR_IN_CERT_NOT_BEFORE_FIELD",
//   "ERROR_IN_CERT_NOT_AFTER_FIELD", "ERROR_IN_CRL_LAST_UPDATE_FIELD",
//   "ERROR_IN_CRL_NEXT_UPDATE_FIELD", "OUT_OF_MEM",
//   "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
//   "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
//   "CERT_CHAIN_TOO_LONG", "CERT_REVOKED" "INVALID_CA",
//   "PATH_LENGTH_EXCEEDED", "INVALID_PURPOSE" "CERT_UNTRUSTED",
//   "CERT_REJECTED"
//
function Server(options, listener) {
  if (!(this instanceof Server)) return new Server(options, listener);

  if (typeof options === "function") {
    listener = options;
    options = {};
  } else if (options == null || typeof options === "object") {
    options = options || {};
  } else {
    throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
  }

  this._contexts = [];
  this.requestCert = options.requestCert === true;
  this.rejectUnauthorized = options.rejectUnauthorized !== false;
  this._options = options;

  if (options.sessionTimeout) this.sessionTimeout = options.sessionTimeout;

  this[kHandshakeTimeout] = options.handshakeTimeout || 120 * 1000;

  validateNumber(this[kHandshakeTimeout], "options.handshakeTimeout");

  // constructor call
  Reflect.apply(_Server, this, [options, tlsConnectionListener]);

  if (listener) {
    this.on("secureConnection", listener);
  }
}

Object.setPrototypeOf(Server.prototype, _Server.prototype);
Object.setPrototypeOf(Server, _Server);

function createServer(options, listener) {
  return new Server(options, listener);
}

export { Server, createServer };
