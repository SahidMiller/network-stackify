import { Socket, _normalizeArgs } from "net";
import { _extend } from "util";
import { Duplex } from "stream";
import forge, { forge as _forge, pki, tls } from "node-forge";

import rootCerts from "./rootCertificates.js";
import { checkServerIdentity } from "./checkServerIdentity.js";

// Compatibility shim for the browser
if (_forge) {
  forge = _forge;
}

export class TLSSocket extends Duplex {
  constructor(socket, options) {
    console.log(options);
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
    const rootCertificates = this._options.rootCertificates || rootCerts;
    const caStore = pki.createCaStore([]);

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
    const sslOptions = {
      server: options.isServer,
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
            !checkServerIdentity(
              options.servername,
              cn,
              subjectAltNames && subjectAltNames.altNames,
              currentCert
            )
          ) {
            verified = {
              alert: tls.Alert.Description.bad_certificate,
              message: "Certificate common name does not match hostname.",
            };
            console.warn("[tls] " + cn + " !== " + options.servername);
          }

          try {
            if (pki.verifyCertificateChain(caStore, certs)) {
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
    };

    if (options.isServer) {
      sslOptions.getCertificate = () => options.cert;
      sslOptions.getPrivateKey = () => options.key;
    }

    this.ssl = tls.createConnection(sslOptions);

    this._socket.on("data", (data) => {
      self.log(
        "[tls] recieved from socket:",
        Buffer.from(data, "binary").toString("hex")
      );

      //Shows up after recieved
      self.ssl.process(data.toString("binary")); // encoding should be 'binary'
    });

    if (!options.isServer) {
      this.log("[tls] handshaking");
      this.ssl.handshake();
    }
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
    options = _extend(options, listArgs[1]);
  } else if (isObject(listArgs[2])) {
    options = _extend(options, listArgs[2]);
  }
  return cb ? [options, cb] : [options];
}

function onConnectSecure() {
  this.emit("secureConnect");
}

export function connect(...args) {
  var args = normalizeConnectArgs(args);
  var options = args[0];
  var cb = args[1];

  var defaults = {
    rejectUnauthorized: "0" !== process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    ciphers: null, //tls.DEFAULT_CIPHERS
  };

  options = _extend(defaults, options || {});

  var socket = new TLSSocket(options.socket, {
    ...options,
    isServer: false,
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
}
