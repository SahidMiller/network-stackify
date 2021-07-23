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

import { createConnection as _createConnection, isIP } from "net";
import EventEmitter from "events";
import { errors, validators } from "@network-stackify/stack/utils";

import { debuglog } from "util"
let debug = debuglog("http", (fn) => {
  debug = fn;
});

const {
  codes: { ERR_OUT_OF_RANGE },
} = errors;

const { validateNumber, validateOneOf, validateString } = validators;

const kOnKeylog = Symbol("onkeylog");
const kRequestOptions = Symbol("requestOptions");
// New Agent code.

// The largest departure from the previous implementation is that
// an Agent instance holds connections for a variable number of host:ports.
// Surprisingly, this is still API compatible as far as third parties are
// concerned. The only code that really notices the difference is the
// request object.

// Another departure is that all code related to HTTP parsing is in
// ClientRequest.onSocket(). The Agent is now *strictly*
// concerned with managing a connection pool.

function freeSocketErrorListener(err) {
  const socket = this;
  debug("SOCKET ERROR on FREE socket:", err.message, err.stack);
  socket.destroy();
  socket.emit("agentRemove");
}

function Agent(options) {
  if (!(this instanceof Agent)) return new Agent(options);

  EventEmitter.call(this);

  this.defaultPort = 80;
  this.protocol = "http:";

  this.options = { __proto__: null, ...options };

  // Don't confuse net and make it think that we're connecting to a pipe
  this.options.path = null;
  this.requests = Object.create(null);
  this.sockets = Object.create(null);
  this.freeSockets = Object.create(null);
  this.keepAliveMsecs = this.options.keepAliveMsecs || 1000;
  this.keepAlive = this.options.keepAlive || false;
  this.maxSockets = this.options.maxSockets || Agent.defaultMaxSockets;
  this.maxFreeSockets = this.options.maxFreeSockets || 256;
  this.scheduling = this.options.scheduling || "lifo";
  this.maxTotalSockets = this.options.maxTotalSockets || 99;
  this.totalSocketCount = 0;

  validateOneOf(this.scheduling, "scheduling", ["fifo", "lifo"]);

  if (this.maxTotalSockets !== undefined) {
    validateNumber(this.maxTotalSockets, "maxTotalSockets");
    if (this.maxTotalSockets <= 0 || Number.isNaN(this.maxTotalSockets))
      throw new ERR_OUT_OF_RANGE(
        "maxTotalSockets",
        "> 0",
        this.maxTotalSockets
      );
  } else {
    this.maxTotalSockets = Infinity;
  }

  this.on("free", (socket, options) => {
    const name = this.getName(options);
    debug("agent.on(free)", name);

    // TODO(ronag): socket.destroy(err) might have been called
    // before coming here and have an 'error' scheduled. In the
    // case of socket.destroy() below this 'error' has no handler
    // and could cause unhandled exception.

    if (!socket.writable) {
      socket.destroy();
      return;
    }

    const requests = this.requests[name];
    if (requests && requests.length) {
      const req = Array.prototype.shift.call(requests);
      setRequestSocket(this, req, socket);

      if (requests.length === 0) {
        delete this.requests[name];
      }
      return;
    }

    // If there are no pending requests, then put it in
    // the freeSockets pool, but only if we're allowed to do so.
    const req = socket._httpMessage;
    if (!req || !req.shouldKeepAlive || !this.keepAlive) {
      socket.destroy();
      return;
    }

    const freeSockets = this.freeSockets[name] || [];
    const freeLen = freeSockets.length;
    let count = freeLen;
    if (this.sockets[name]) count += this.sockets[name].length;

    if (
      this.totalSocketCount > this.maxTotalSockets ||
      count > this.maxSockets ||
      freeLen >= this.maxFreeSockets ||
      !this.keepSocketAlive(socket)
    ) {
      socket.destroy();
      return;
    }

    this.freeSockets[name] = freeSockets;
    socket._httpMessage = null;
    this.removeSocket(socket, options);

    socket.once("error", freeSocketErrorListener);
    Array.prototype.push.call(freeSockets, socket);
  });

  // Don't emit keylog events unless there is a listener for them.
  this.on("newListener", maybeEnableKeylog);
}
Object.setPrototypeOf(Agent.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Agent, EventEmitter);

function maybeEnableKeylog(eventName) {
  if (eventName === "keylog") {
    this.removeListener("newListener", maybeEnableKeylog);
    // Future sockets will listen on keylog at creation.
    const agent = this;
    this[kOnKeylog] = function onkeylog(keylog) {
      agent.emit("keylog", keylog, this);
    };
    // Existing sockets will start listening on keylog now.
    const sockets = Object.values(this.sockets);
    for (let i = 0; i < sockets.length; i++) {
      sockets[i].on("keylog", this[kOnKeylog]);
    }
  }
}

Agent.defaultMaxSockets = Infinity;

// Get the key for a given set of request options
Agent.prototype.getName = function getName(options) {
  let name = options.host || "localhost";

  name += ":";
  if (options.port) name += options.port;

  name += ":";
  if (options.localAddress) name += options.localAddress;

  // Pacify parallel/test-http-agent-getname by only appending
  // the ':' when options.family is set.
  if (options.family === 4 || options.family === 6)
    name += `:${options.family}`;

  if (options.socketPath) name += `:${options.socketPath}`;

  return name;
};

Agent.prototype.addRequest = function addRequest(
  req,
  options,
  port /* legacy */,
  localAddress /* legacy */
) {
  // Legacy API: addRequest(req, host, port, localAddress)
  if (typeof options === "string") {
    options = {
      __proto__: null,
      host: options,
      port,
      localAddress,
    };
  }

  options = { __proto__: null, ...options, ...this.options };
  if (options.socketPath) options.path = options.socketPath;

  if (!options.servername && options.servername !== "")
    options.servername = calculateServerName(options, req);

  const name = this.getName(options);
  if (!this.sockets[name]) {
    this.sockets[name] = [];
  }

  const freeSockets = this.freeSockets[name];
  let socket;
  if (freeSockets) {
    while (freeSockets.length && freeSockets[0].destroyed) {
      Array.prototype.shift.call(freeSockets);
    }
    socket =
      this.scheduling === "fifo"
        ? Array.prototype.shift.call(freeSockets)
        : Array.prototype.pop.call(freeSockets);
    if (!freeSockets.length) delete this.freeSockets[name];
  }

  const freeLen = freeSockets ? freeSockets.length : 0;
  const sockLen = freeLen + this.sockets[name].length;

  if (socket) {
    this.reuseSocket(socket, req);
    setRequestSocket(this, req, socket);
    Array.prototype.push.call(this.sockets[name], socket);
    this.totalSocketCount++;
  } else if (
    sockLen < this.maxSockets &&
    this.totalSocketCount < this.maxTotalSockets
  ) {
    debug("call onSocket", sockLen, freeLen);
    // If we are under maxSockets create a new one.
    this.createSocket(req, options, (err, socket) => {
      if (err) req.onSocket(socket, err);
      else setRequestSocket(this, req, socket);
    });
  } else {
    debug("wait for socket");
    // We are over limit so we'll add it to the queue.
    if (!this.requests[name]) {
      this.requests[name] = [];
    }

    // Used to create sockets for pending requests from different origin
    req[kRequestOptions] = options;

    Array.prototype.push.call(this.requests[name], req);
  }
};

Agent.prototype.createConnection = function createConnection(options) {
  const createConn = this.options.createConnection || _createConnection;
  return createConn(options);
};

Agent.prototype.createSocket = function createSocket(req, options, cb) {
  options = { __proto__: null, ...options, ...this.options };
  if (options.socketPath) options.path = options.socketPath;

  if (!options.servername && options.servername !== "")
    options.servername = calculateServerName(options, req);

  const name = this.getName(options);
  options._agentKey = name;

  debug("createConnection", name, options);
  options.encoding = null;

  let created = false;
  const oncreate = (err, s) => {
    if (created) return;
    if (err) return cb(err);
    if (!this.sockets[name]) {
      this.sockets[name] = [];
    }
    Array.prototype.push.call(this.sockets[name], s);
    this.totalSocketCount++;
    debug("sockets", name, this.sockets[name].length, this.totalSocketCount);
    installListeners(this, s, options);
    cb(null, s);
  };

  const newSocket = this.createConnection(options);
  if (newSocket) oncreate(null, newSocket);
};

function calculateServerName(options, req) {
  let servername = options.host;
  const hostHeader = req.getHeader("host");
  if (hostHeader) {
    validateString(hostHeader, "options.headers.host");

    // abc => abc
    // abc:123 => abc
    // [::1] => ::1
    // [::1]:123 => ::1
    if (String.prototype.startsWith.call(hostHeader, "[")) {
      const index = String.prototype.indexOf.call(hostHeader, "]");
      if (index === -1) {
        // Leading '[', but no ']'. Need to do something...
        servername = hostHeader;
      } else {
        servername = String.prototype.substr.call(hostHeader, 1, index - 1);
      }
    } else {
      servername = String.prototype.split.call(hostHeader, ":", 1)[0];
    }
  }
  // Don't implicitly set invalid (IP) servernames.
  if (isIP(servername)) servername = "";
  return servername;
}

function installListeners(agent, s, options) {
  function onFree() {
    debug("CLIENT socket onFree");
    agent.emit("free", s, options);
  }
  s.on("free", onFree);

  function onClose(err) {
    debug("CLIENT socket onClose");
    // This is the only place where sockets get removed from the Agent.
    // If you want to remove a socket from the pool, just close it.
    // All socket errors end in a close event anyway.
    agent.removeSocket(s, options);
  }
  s.on("close", onClose);

  function onTimeout() {
    debug("CLIENT socket onTimeout");

    // Destroy if in free list.
    // TODO(ronag): Always destroy, even if not in free list.
    const sockets = agent.freeSockets;
    if (
      Array.prototype.some.call(Object.keys(sockets), (name) =>
        Array.prototype.includes.call(sockets[name], s)
      )
    ) {
      return s.destroy();
    }
  }
  s.on("timeout", onTimeout);

  function onRemove() {
    // We need this function for cases like HTTP 'upgrade'
    // (defined by WebSockets) where we need to remove a socket from the
    // pool because it'll be locked up indefinitely
    debug("CLIENT socket onRemove");
    agent.removeSocket(s, options);
    s.removeListener("close", onClose);
    s.removeListener("free", onFree);
    s.removeListener("timeout", onTimeout);
    s.removeListener("agentRemove", onRemove);
  }
  s.on("agentRemove", onRemove);

  if (agent[kOnKeylog]) {
    s.on("keylog", agent[kOnKeylog]);
  }
}

Agent.prototype.removeSocket = function removeSocket(s, options) {
  const name = this.getName(options);
  debug("removeSocket", name, "writable:", s.writable);
  const sets = [this.sockets];

  // If the socket was destroyed, remove it from the free buffers too.
  if (!s.writable) Array.prototype.push.call(sets, this.freeSockets);

  for (let sk = 0; sk < sets.length; sk++) {
    const sockets = sets[sk];

    if (sockets[name]) {
      const index = Array.prototype.indexOf.call(sockets[name], s);
      if (index !== -1) {
        Array.prototype.splice.call(sockets[name], index, 1);
        // Don't leak
        if (sockets[name].length === 0) delete sockets[name];
        this.totalSocketCount--;
      }
    }
  }

  let req;
  if (this.requests[name] && this.requests[name].length) {
    debug("removeSocket, have a request, make a socket");
    req = this.requests[name][0];
  } else {
    // TODO(rickyes): this logic will not be FIFO across origins.
    // There might be older requests in a different origin, but
    // if the origin which releases the socket has pending requests
    // that will be prioritized.
    const keys = Object.keys(this.requests);
    for (let i = 0; i < keys.length; i++) {
      const prop = keys[i];
      // Check whether this specific origin is already at maxSockets
      if (this.sockets[prop] && this.sockets[prop].length) break;
      debug(
        "removeSocket, have a request with different origin," + " make a socket"
      );
      req = this.requests[prop][0];
      options = req[kRequestOptions];
      break;
    }
  }

  if (req && options) {
    req[kRequestOptions] = undefined;
    // If we have pending requests and a socket gets closed make a new one
    this.createSocket(req, options, (err, socket) => {
      if (err) req.onSocket(socket, err);
      else socket.emit("free");
    });
  }
};

Agent.prototype.keepSocketAlive = function keepSocketAlive(socket) {
  socket.setKeepAlive(true, this.keepAliveMsecs);
  socket.unref();

  const agentTimeout = this.options.timeout || 0;
  if (socket.timeout !== agentTimeout) {
    socket.setTimeout(agentTimeout);
  }

  return true;
};

Agent.prototype.reuseSocket = function reuseSocket(socket, req) {
  debug("have free socket");
  socket.removeListener("error", freeSocketErrorListener);
  req.reusedSocket = true;
  socket.ref();
};

Agent.prototype.destroy = function destroy() {
  const sets = [this.freeSockets, this.sockets];
  for (let s = 0; s < sets.length; s++) {
    const set = sets[s];
    const keys = Object.keys(set);
    for (let v = 0; v < keys.length; v++) {
      const setName = set[keys[v]];
      for (let n = 0; n < setName.length; n++) {
        setName[n].destroy();
      }
    }
  }
};

function setRequestSocket(agent, req, socket) {
  req.onSocket(socket);
  const agentTimeout = agent.options.timeout || 0;
  if (req.timeout === undefined || req.timeout === agentTimeout) {
    return;
  }
  socket.setTimeout(req.timeout);
}

const globalAgent = new Agent();
export { Agent, globalAgent };
