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

import EventEmitter from "events";
import { normalizedArgsSymbol } from "@network-stackify/stack/utils/net.js";
import { codes } from "@network-stackify/stack/utils/errors.js";

import { debuglog } from "util"
let debug = debuglog("net", (fn) => {
  debug = fn;
});

const {
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_ARG_VALUE,
    ERR_SERVER_ALREADY_LISTEN,
    ERR_SERVER_NOT_RUNNING,
  } = codes;
import { validateAbortSignal } from "@network-stackify/stack/utils/validators.js";
import { Socket } from "./socket.js";

function isPipeName(s) {
  return typeof s === "string" && toNumber(s) === false;
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

// Returns an array [options, cb], where options is an object,
// cb is either a function or null.
// Used to normalize arguments of Socket.prototype.connect() and
// Server.prototype.listen(). Possible combinations of parameters:
//   (options[...][, cb])
//   (path[...][, cb])
//   ([port][, host][...][, cb])
// For Socket.prototype.connect(), the [...] part is ignored
// For Server.prototype.listen(), the [...] part is [, backlog]
// but will not be handled here (handled in listen())
function normalizeArgs(args) {
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    arr[normalizedArgsSymbol] = true;
    return arr;
  }

  const arg0 = args[0];
  let options = {};
  if (typeof arg0 === "object" && arg0 !== null) {
    // (options[...][, cb])
    options = arg0;
  } else if (isPipeName(arg0)) {
    // (path[...][, cb])
    options.path = arg0;
  } else {
    // ([port][, host][...][, cb])
    options.port = arg0;
    if (args.length > 1 && typeof args[1] === "string") {
      options.host = args[1];
    }
  }

  const cb = args[args.length - 1];
  if (typeof cb !== "function") arr = [options, null];
  else arr = [options, cb];

  arr[normalizedArgsSymbol] = true;
  return arr;
}

function addAbortSignalOption(self, options) {
  if (options?.signal === undefined) {
    return;
  }
  validateAbortSignal(options.signal, "options.signal");
  const { signal } = options;
  const onAborted = () => {
    self.close();
  };
  if (signal.aborted) {
    process.nextTick(onAborted);
  } else {
    signal.addEventListener("abort", onAborted);
    self.once("close", () => signal.removeEventListener("abort", onAborted));
  }
}

function Server(options, connectionListener) {
  if (!(this instanceof Server)) return new Server(options, connectionListener);

  EventEmitter.call(this);

  if (typeof options === "function") {
    connectionListener = options;
    options = {};
    this.on("connection", connectionListener);
  } else if (options == null || typeof options === "object") {
    options = { ...options };

    if (typeof connectionListener === "function") {
      this.on("connection", connectionListener);
    }
  } else {
    throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
  }

  this._connections = 0;

  this._handle = null;
  this._usingWorkers = false;
  this._workers = [];
  this._unref = false;

  this.allowHalfOpen = options.allowHalfOpen || false;
  this.pauseOnConnect = !!options.pauseOnConnect;
}
Object.setPrototypeOf(Server.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Server, EventEmitter);

function toNumber(x) {
  return (x = Number(x)) >= 0 ? x : false;
}
Server.prototype.listen = function (...args) {
  const normalized = normalizeArgs(args);
  let options = normalized[0];
  const cb = normalized[1];

  if (this.listening) {
    throw new ERR_SERVER_ALREADY_LISTEN();
  }

  if (cb !== null) {
    this.once("listening", cb);
  }

  addAbortSignalOption(this, options);

  // ([port][, host][, backlog][, cb]) where port is omitted,
  // that is, listen(), listen(null), listen(cb), or listen(null, cb)
  // or (options[, cb]) where options.port is explicitly set as undefined or
  // null, bind to an arbitrary unused port
  if (
    args.length === 0 ||
    typeof args[0] === "function" ||
    (typeof options.protocol === "undefined" && "protocol" in options) ||
    options.protocol === null
  ) {
    options.protocol = undefined;
  }

  if (!("protocol" in options)) {
    throw new ERR_INVALID_ARG_VALUE(
      "options",
      options,
      'must have the property "protocol"'
    );
  }

  if (!("libp2p" in options)) {
    throw new ERR_INVALID_ARG_VALUE(
      "options",
      options,
      'must have the property "libp2p"'
    );
  }

  const self = this;
  this._ma = options.libp2p.peerId.toB58String();
  this._protocol =
    options.protocol[0] === "/" ? options.protocol : "/" + options.protocol;
  this._port = options.port;

  options.libp2p.handle(this._protocol, ({ connection, stream, protocol }) => {
    console.log(connection, stream, protocol);
    debug("onconnection");

    try {
      if (self.maxConnections && self._connections >= self.maxConnections) {
        //TODO God willing: close properly
        stream.close();
        return;
      }

      const socket = new Socket({
        stream: stream,
        readable: true,
        writable: true,
      });

      self._connections++;
      socket.server = self;
      socket._server = self;

      self.emit("connection", socket);
    } catch (err) {
      console.log(err);
    }
  });

  //TODO God willing: ipfs.libp2p.unhandle and watch if ipfs/libp2p close, God willing.
  // this._handle.close = function () {
  // }

  this.listening = true;
  this.emit("listening");
};

Server.prototype.address = function () {
  if (this.listening) {
    return { address: this._ma, family: "LIBP2P", protocol: this._protocol, port: this._port };
  }

  return null;
};

Server.prototype.close = function (cb) {
  if (typeof cb === "function") {
    if (!this.listening) {
      this.once("close", function close() {
        cb(new ERR_SERVER_NOT_RUNNING());
      });
    } else {
      this.once("close", cb);
    }
  }

  this._emitCloseIfDrained();

  return this;
};

Server.prototype._emitCloseIfDrained = function () {
  debug("SERVER _emitCloseIfDrained");

  if (this._handle || this._connections) {
    debug(
      "SERVER handle? %j   connections? %d",
      !!this._handle,
      this._connections
    );
    return;
  }

  process.nextTick(emitCloseNT, this);
};

function emitCloseNT(self) {
  debug("SERVER: emit close");
  self.emit("close");
}

Server.prototype.ref = function () {
  this._unref = false;
  return this;
};

Server.prototype.unref = function () {
  this._unref = true;
  return this;
};

export { Server, createServer };
