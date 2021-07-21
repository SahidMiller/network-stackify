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

const EventEmitter = require("events");
let debug = require("util").debuglog("net", (fn) => {
  debug = fn;
});
const { normalizedArgsSymbol } = require("../../../utils/net");
const assert = require("assert");

const {
  codes: {
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_ARG_VALUE,
    ERR_INVALID_FD_TYPE,
    ERR_SERVER_ALREADY_LISTEN,
    ERR_SERVER_NOT_RUNNING,
  },
  errnoException,
  exceptionWithHostPort,
} = require("../../../utils/errors");
const {
  validateAbortSignal,
  validateInt32,
  validatePort,
} = require("../../../utils/validators");

// const { UV_EINVAL } = internalBinding("uv");
// const { guessHandleType } = internalBinding("util");
// const { TCP, constants: TCPConstants } = internalBinding("tcp_wrap");
// const { Pipe, constants: PipeConstants } = internalBinding("pipe_wrap");
// const {
//   newAsyncId,
//   defaultTriggerAsyncIdScope,
//   symbols: { async_id_symbol, owner_symbol },
// } = require("internal/async_hooks");

// Lazy loaded to improve startup performance.
let cluster;
let dns;

const DEFAULT_IPV4_ADDR = "0.0.0.0";
const DEFAULT_IPV6_ADDR = "::";

const isWindows = process.platform === "win32";

const noop = () => {};

function getFlags(ipv6Only) {
  return ipv6Only === true ? TCPConstants.UV_TCP_IPV6ONLY : 0;
}

function createHandle(fd, is_server) {
  validateInt32(fd, "fd", 0);
  const type = guessHandleType(fd);
  if (type === "PIPE") {
    return new Pipe(is_server ? PipeConstants.SERVER : PipeConstants.SOCKET);
  }

  if (type === "TCP") {
    return new TCP(is_server ? TCPConstants.SERVER : TCPConstants.SOCKET);
  }

  throw new ERR_INVALID_FD_TYPE(type);
}

function getNewAsyncId(handle) {
  return !handle || typeof handle.getAsyncId !== "function"
    ? newAsyncId()
    : handle.getAsyncId();
}

function isPipeName(s) {
  return typeof s === "string" && toNumber(s) === false;
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

// Target API:
//
// let s = net.connect({port: 80, host: 'google.com'}, function() {
//   ...
// });
//
// There are various forms:
//
// connect(options, [cb])
// connect(port, [host], [cb])
// connect(path, [cb]);
//
function connect(...args) {
  const normalized = normalizeArgs(args);
  const options = normalized[0];
  debug("createConnection", normalized);
  const socket = new Socket(options);

  if (options.timeout) {
    socket.setTimeout(options.timeout);
  }

  return socket.connect(normalized);
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

  this[async_id_symbol] = -1;
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

// Returns handle if it can be created, or error code if it can't
function createServerHandle(address, port, addressType, fd, flags) {
  let err = 0;
  // Assign handle in listen, and clean up if bind or listen fails
  let handle;

  let isTCP = false;
  if (typeof fd === "number" && fd >= 0) {
    try {
      handle = createHandle(fd, true);
    } catch (e) {
      // Not a fd we can listen on.  This will trigger an error.
      debug("listen invalid fd=%d:", fd, e.message);
      return UV_EINVAL;
    }

    err = handle.open(fd);
    if (err) return err;

    assert(!address && !port);
  } else if (port === -1 && addressType === -1) {
    handle = new Pipe(PipeConstants.SERVER);
    if (isWindows) {
      const instances = Number.parseInt(
        process.env.NODE_PENDING_PIPE_INSTANCES
      );
      if (!Number.isNaN(instances)) {
        handle.setPendingInstances(instances);
      }
    }
  } else {
    handle = new TCP(TCPConstants.SERVER);
    isTCP = true;
  }

  if (address || port || isTCP) {
    debug("bind to", address || "any");
    if (!address) {
      // Try binding to ipv6 first
      err = handle.bind6(DEFAULT_IPV6_ADDR, port, flags);
      if (err) {
        handle.close();
        // Fallback to ipv4
        return createServerHandle(DEFAULT_IPV4_ADDR, port);
      }
    } else if (addressType === 6) {
      err = handle.bind6(address, port, flags);
    } else {
      err = handle.bind(address, port);
    }
  }

  if (err) {
    handle.close();
    return err;
  }

  return handle;
}

//TODO God willing: listen handle rval remove for libp2p
function setupListenHandle(address, port, addressType, backlog, fd, flags) {
  debug("setupListenHandle", address, port, addressType, backlog, fd);

  // If there is not yet a handle, we need to create one and bind.
  // In the case of a server sent via IPC, we don't need to do this.
  if (this._handle) {
    debug("setupListenHandle: have a handle already");
  } else {
    debug("setupListenHandle: create a handle");

    let rval = null;

    // Try to bind to the unspecified IPv6 address, see if IPv6 is available
    if (!address && typeof fd !== "number") {
      rval = createServerHandle(DEFAULT_IPV6_ADDR, port, 6, fd, flags);

      if (typeof rval === "number") {
        rval = null;
        address = DEFAULT_IPV4_ADDR;
        addressType = 4;
      } else {
        address = DEFAULT_IPV6_ADDR;
        addressType = 6;
      }
    }

    if (rval === null)
      rval = createServerHandle(address, port, addressType, fd, flags);

    if (typeof rval === "number") {
      const error = uvExceptionWithHostPort(rval, "listen", address, port);
      process.nextTick(emitErrorNT, this, error);
      return;
    }
    this._handle = rval;
  }

  this[async_id_symbol] = getNewAsyncId(this._handle);
  this._handle.onconnection = onconnection;
  this._handle[owner_symbol] = this;

  // Use a backlog of 512 entries. We pass 511 to the listen() call because
  // the kernel does: backlogsize = roundup_pow_of_two(backlogsize + 1);
  // which will thus give us a backlog of 512 entries.
  const err = this._handle.listen(backlog || 511);

  if (err) {
    const ex = uvExceptionWithHostPort(err, "listen", address, port);
    this._handle.close();
    this._handle = null;
    defaultTriggerAsyncIdScope(
      this[async_id_symbol],
      process.nextTick,
      emitErrorNT,
      this,
      ex
    );
    return;
  }

  // Generate connection key, this should be unique to the connection
  this._connectionKey = addressType + ":" + address + ":" + port;

  // Unref the handle if the server was unref'ed prior to listening
  if (this._unref) this.unref();

  defaultTriggerAsyncIdScope(
    this[async_id_symbol],
    process.nextTick,
    emitListeningNT,
    this
  );
}

Server.prototype._listen2 = setupListenHandle; // legacy alias

function emitErrorNT(self, err) {
  self.emit("error", err);
}

function emitListeningNT(self) {
  // Ensure handle hasn't closed
  if (self._handle) self.emit("listening");
}

function listenInCluster(
  server,
  address,
  port,
  addressType,
  backlog,
  fd,
  exclusive,
  flags
) {
  exclusive = !!exclusive;

  if (cluster === undefined) cluster = require("cluster");

  if (cluster.isPrimary || exclusive) {
    // Will create a new handle
    // _listen2 sets up the listened handle, it is still named like this
    // to avoid breaking code that wraps this method
    server._listen2(address, port, addressType, backlog, fd, flags);
    return;
  }

  const serverQuery = {
    address: address,
    port: port,
    addressType: addressType,
    fd: fd,
    flags,
  };

  // Get the primary's server handle, and listen on it
  cluster._getServer(server, serverQuery, listenOnPrimaryHandle);

  function listenOnPrimaryHandle(err, handle) {
    err = checkBindError(err, port, handle);

    if (err) {
      const ex = exceptionWithHostPort(err, "bind", address, port);
      return server.emit("error", ex);
    }

    // Reuse primary's server handle
    server._handle = handle;
    // _listen2 sets up the listened handle, it is still named like this
    // to avoid breaking code that wraps this method
    server._listen2(address, port, addressType, backlog, fd, flags);
  }
}

Server.prototype.listen = function (...args) {
  const normalized = normalizeArgs(args);
  let options = normalized[0];
  const cb = normalized[1];

  if (this._handle) {
    throw new ERR_SERVER_ALREADY_LISTEN();
  }

  if (cb !== null) {
    this.once("listening", cb);
  }
  const backlogFromArgs =
    // (handle, backlog) or (path, backlog) or (port, backlog)
    toNumber(args.length > 1 && args[1]) ||
    toNumber(args.length > 2 && args[2]); // (port, host, backlog)

  options = options._handle || options.handle || options;
  const flags = getFlags(options.ipv6Only);
  // (handle[, backlog][, cb]) where handle is an object with a handle
  if (options instanceof TCP) {
    this._handle = options;
    this[async_id_symbol] = this._handle.getAsyncId();
    listenInCluster(this, null, -1, -1, backlogFromArgs);
    return this;
  }
  addAbortSignalOption(this, options);
  // (handle[, backlog][, cb]) where handle is an object with a fd
  if (typeof options.fd === "number" && options.fd >= 0) {
    listenInCluster(this, null, null, null, backlogFromArgs, options.fd);
    return this;
  }

  // ([port][, host][, backlog][, cb]) where port is omitted,
  // that is, listen(), listen(null), listen(cb), or listen(null, cb)
  // or (options[, cb]) where options.port is explicitly set as undefined or
  // null, bind to an arbitrary unused port
  if (
    args.length === 0 ||
    typeof args[0] === "function" ||
    (typeof options.port === "undefined" && "port" in options) ||
    options.port === null
  ) {
    options.port = 0;
  }
  // ([port][, host][, backlog][, cb]) where port is specified
  // or (options[, cb]) where options.port is specified
  // or if options.port is normalized as 0 before
  let backlog;
  if (typeof options.port === "number" || typeof options.port === "string") {
    validatePort(options.port, "options.port");
    backlog = options.backlog || backlogFromArgs;
    // start TCP server listening on host:port
    if (options.host) {
      lookupAndListen(
        this,
        options.port | 0,
        options.host,
        backlog,
        options.exclusive,
        flags
      );
    } else {
      // Undefined host, listens on unspecified address
      // Default addressType 4 will be used to search for primary server
      listenInCluster(
        this,
        null,
        options.port | 0,
        4,
        backlog,
        undefined,
        options.exclusive
      );
    }
    return this;
  }

  // (path[, backlog][, cb]) or (options[, cb])
  // where path or options.path is a UNIX domain socket or Windows pipe
  if (options.path && isPipeName(options.path)) {
    const pipeName = (this._pipeName = options.path);
    backlog = options.backlog || backlogFromArgs;
    listenInCluster(
      this,
      pipeName,
      -1,
      -1,
      backlog,
      undefined,
      options.exclusive
    );

    if (!this._handle) {
      // Failed and an error shall be emitted in the next tick.
      // Therefore, we directly return.
      return this;
    }

    let mode = 0;
    if (options.readableAll === true) mode |= PipeConstants.UV_READABLE;
    if (options.writableAll === true) mode |= PipeConstants.UV_WRITABLE;
    if (mode !== 0) {
      const err = this._handle.fchmod(mode);
      if (err) {
        this._handle.close();
        this._handle = null;
        throw errnoException(err, "uv_pipe_chmod");
      }
    }
    return this;
  }

  if (!("port" in options || "path" in options)) {
    throw new ERR_INVALID_ARG_VALUE(
      "options",
      options,
      'must have the property "port" or "path"'
    );
  }

  throw new ERR_INVALID_ARG_VALUE("options", options);
};

function lookupAndListen(self, port, address, backlog, exclusive, flags) {
  if (dns === undefined) dns = require("dns");
  dns.lookup(address, function doListen(err, ip, addressType) {
    if (err) {
      self.emit("error", err);
    } else {
      addressType = ip ? addressType : 4;
      listenInCluster(
        self,
        ip,
        port,
        addressType,
        backlog,
        undefined,
        exclusive,
        flags
      );
    }
  });
}

Object.defineProperty(Server.prototype, "listening", {
  get: function () {
    return !!this._handle;
  },
  configurable: true,
  enumerable: true,
});

Server.prototype.address = function () {
  if (this._handle && this._handle.getsockname) {
    const out = {};
    const err = this._handle.getsockname(out);
    if (err) {
      throw errnoException(err, "address");
    }
    return out;
  } else if (this._pipeName) {
    return this._pipeName;
  }
  return null;
};

function onconnection(err, clientHandle) {
  const handle = this;
  const self = handle[owner_symbol];

  debug("onconnection");

  if (err) {
    self.emit("error", errnoException(err, "accept"));
    return;
  }

  if (self.maxConnections && self._connections >= self.maxConnections) {
    clientHandle.close();
    return;
  }

  const socket = new Socket({
    handle: clientHandle,
    allowHalfOpen: self.allowHalfOpen,
    pauseOnCreate: self.pauseOnConnect,
    readable: true,
    writable: true,
  });

  self._connections++;
  socket.server = self;
  socket._server = self;

  self.emit("connection", socket);
}

Server.prototype.getConnections = function (cb) {
  const self = this;

  function end(err, connections) {
    defaultTriggerAsyncIdScope(
      self[async_id_symbol],
      process.nextTick,
      cb,
      err,
      connections
    );
  }

  if (!this._usingWorkers) {
    end(null, this._connections);
    return this;
  }

  // Poll workers
  let left = this._workers.length;
  let total = this._connections;

  function oncount(err, count) {
    if (err) {
      left = -1;
      return end(err);
    }

    total += count;
    if (--left === 0) return end(null, total);
  }

  for (let n = 0; n < this._workers.length; n++) {
    this._workers[n].getConnections(oncount);
  }

  return this;
};

Server.prototype.close = function (cb) {
  if (typeof cb === "function") {
    if (!this._handle) {
      this.once("close", function close() {
        cb(new ERR_SERVER_NOT_RUNNING());
      });
    } else {
      this.once("close", cb);
    }
  }

  if (this._handle) {
    this._handle.close();
    this._handle = null;
  }

  if (this._usingWorkers) {
    let left = this._workers.length;
    const onWorkerClose = () => {
      if (--left !== 0) return;

      this._connections = 0;
      this._emitCloseIfDrained();
    };

    // Increment connections to be sure that, even if all sockets will be closed
    // during polling of workers, `close` event will be emitted only once.
    this._connections++;

    // Poll workers
    for (let n = 0; n < this._workers.length; n++)
      this._workers[n].close(onWorkerClose);
  } else {
    this._emitCloseIfDrained();
  }

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

  defaultTriggerAsyncIdScope(
    this[async_id_symbol],
    process.nextTick,
    emitCloseNT,
    this
  );
};

function emitCloseNT(self) {
  debug("SERVER: emit close");
  self.emit("close");
}

Server.prototype[EventEmitter.captureRejectionSymbol] = function (
  err,
  event,
  sock
) {
  switch (event) {
    case "connection":
      sock.destroy(err);
      break;
    default:
      this.emit("error", err);
  }
};

// Legacy alias on the C++ wrapper object. This is not public API, so we may
// want to runtime-deprecate it at some point. There's no hurry, though.
Object.defineProperty(TCP.prototype, "owner", {
  get() {
    return this[owner_symbol];
  },
  set(v) {
    return (this[owner_symbol] = v);
  },
});

Server.prototype._setupWorker = function (socketList) {
  this._usingWorkers = true;
  this._workers.push(socketList);
  socketList.once("exit", (socketList) => {
    const index = Array.prototype.indexOf.call(this._workers, socketList);
    this._workers.splice(index, 1);
  });
};

Server.prototype.ref = function () {
  this._unref = false;

  if (this._handle) this._handle.ref();

  return this;
};

Server.prototype.unref = function () {
  this._unref = true;

  if (this._handle) this._handle.unref();

  return this;
};

module.exports = { Server };
