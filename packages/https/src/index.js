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

const { Agent: HttpAgent, ClientRequest } = require("@network-stackify/http");
let debug = require("util").debuglog("https", (fn) => {
  debug = fn;
});
const searchParamsSymbol = Symbol("query");

function urlToHttpOptions(url) {
  const options = {
    protocol: url.protocol,
    hostname:
      typeof url.hostname === "string" && url.hostname.startsWith("[")
        ? url.hostname.slice(1, -1)
        : url.hostname,
    hash: url.hash,
    search: url.search,
    pathname: url.pathname,
    path: `${url.pathname || ""}${url.search || ""}`,
    href: url.href,
  };
  if (url.port !== "") {
    options.port = Number(url.port);
  }
  if (url.username || url.password) {
    options.auth = `${url.username}:${url.password}`;
  }
  return options;
}

// HTTPS agents.

function createConnection(port, host, options) {
  if (port !== null && typeof port === "object") {
    options = port;
  } else if (host !== null && typeof host === "object") {
    options = { ...host };
  } else if (options === null || typeof options !== "object") {
    options = {};
  } else {
    options = { ...options };
  }

  if (typeof port === "number") {
    options.port = port;
  }

  if (typeof host === "string") {
    options.host = host;
  }

  debug("createConnection", options);

  if (options._agentKey) {
    const session = this._getSession(options._agentKey);
    if (session) {
      debug("reuse session for %j", options._agentKey);
      options = {
        session,
        ...options,
      };
    }
  }

  const createConn = options.createConnection || require("tls").connect;
  const socket = createConn(options);

  if (options._agentKey) {
    // Cache new session for reuse
    socket.on("session", (session) => {
      this._cacheSession(options._agentKey, session);
    });

    // Evict session on error
    socket.once("close", (err) => {
      if (err) this._evictSession(options._agentKey);
    });
  }

  return socket;
}

/**
 * Creates a new `HttpAgent` instance.
 * @param {{
 *   keepAlive?: boolean;
 *   keepAliveMsecs?: number;
 *   maxSockets?: number;
 *   maxTotalSockets?: number;
 *   maxFreeSockets?: number;
 *   scheduling?: string;
 *   timeout?: number;
 *   maxCachedSessions?: number;
 *   servername?: string;
 *   }} [options]
 * @returns {Agent}
 */
function Agent(options) {
  if (!(this instanceof Agent)) return new Agent(options);

  HttpAgent.call(this, options);
  this.defaultPort = 443;
  this.protocol = "https:";
  this.maxCachedSessions = this.options.maxCachedSessions;
  if (this.maxCachedSessions === undefined) this.maxCachedSessions = 100;

  this._sessionCache = {
    map: {},
    list: [],
  };
}
Object.setPrototypeOf(Agent.prototype, HttpAgent.prototype);
Object.setPrototypeOf(Agent, HttpAgent);
Agent.prototype.createConnection = createConnection;

/**
 * Gets a unique name for a set of options.
 * @param {{
 *   host: string;
 *   port: number;
 *   localAddress: string;
 *   family: number;
 *   }} [options]
 * @returns {string}
 */
Agent.prototype.getName = function getName(options) {
  let name = Function.prototype.call(
    HttpAgent.prototype.getName,
    this,
    options
  );

  name += ":";
  if (options.ca) name += options.ca;

  name += ":";
  if (options.cert) name += options.cert;

  name += ":";
  if (options.clientCertEngine) name += options.clientCertEngine;

  name += ":";
  if (options.ciphers) name += options.ciphers;

  name += ":";
  if (options.key) name += options.key;

  name += ":";
  if (options.pfx) name += options.pfx;

  name += ":";
  if (options.rejectUnauthorized !== undefined)
    name += options.rejectUnauthorized;

  name += ":";
  if (options.servername && options.servername !== options.host)
    name += options.servername;

  name += ":";
  if (options.minVersion) name += options.minVersion;

  name += ":";
  if (options.maxVersion) name += options.maxVersion;

  name += ":";
  if (options.secureProtocol) name += options.secureProtocol;

  name += ":";
  if (options.crl) name += options.crl;

  name += ":";
  if (options.honorCipherOrder !== undefined) name += options.honorCipherOrder;

  name += ":";
  if (options.ecdhCurve) name += options.ecdhCurve;

  name += ":";
  if (options.dhparam) name += options.dhparam;

  name += ":";
  if (options.secureOptions !== undefined) name += options.secureOptions;

  name += ":";
  if (options.sessionIdContext) name += options.sessionIdContext;

  name += ":";
  if (options.sigalgs) name += JSON.stringify(options.sigalgs);

  name += ":";
  if (options.privateKeyIdentifier) name += options.privateKeyIdentifier;

  name += ":";
  if (options.privateKeyEngine) name += options.privateKeyEngine;

  return name;
};

Agent.prototype._getSession = function _getSession(key) {
  return this._sessionCache.map[key];
};

Agent.prototype._cacheSession = function _cacheSession(key, session) {
  // Cache is disabled
  if (this.maxCachedSessions === 0) return;

  // Fast case - update existing entry
  if (this._sessionCache.map[key]) {
    this._sessionCache.map[key] = session;
    return;
  }

  // Put new entry
  if (this._sessionCache.list.length >= this.maxCachedSessions) {
    const oldKey = Array.prototype.shift.call(this._sessionCache.list);
    debug("evicting %j", oldKey);
    delete this._sessionCache.map[oldKey];
  }

  Array.prototype.push.call(this._sessionCache.list, key);
  this._sessionCache.map[key] = session;
};

Agent.prototype._evictSession = function _evictSession(key) {
  const index = Array.prototype.indexOf.call(this._sessionCache.list, key);
  if (index === -1) return;

  Array.prototype.splice.call(this._sessionCache.list, index, 1);
  delete this._sessionCache.map[key];
};

const globalAgent = new Agent();

/**
 * Makes a request to a secure web server.
 * @param {...any} args
 * @returns {ClientRequest}
 */
function request(...args) {
  let options = {};

  if (typeof args[0] === "string") {
    const urlStr = Array.prototype.shift.call(args);
    options = urlToHttpOptions(new URL(urlStr));
  } else if (
    args[0] &&
    args[0][searchParamsSymbol] &&
    args[0][searchParamsSymbol][searchParamsSymbol]
  ) {
    // url.URL instance
    options = urlToHttpOptions(Array.prototype.shift.call(args));
  }

  if (args[0] && typeof args[0] !== "function") {
    Object.assign(options, Array.prototype.shift.call(args));
  }

  options._defaultAgent = module.exports.globalAgent;
  Array.prototype.unshift.call(args, options);

  return Reflect.construct(ClientRequest, args);
}

/**
 * Makes a GET request to a secure web server.
 * @param {string | URL} input
 * @param {{
 *   agent?: Agent | boolean;
 *   auth?: string;
 *   createConnection?: Function;
 *   defaultPort?: number;
 *   family?: number;
 *   headers?: Object;
 *   hints?: number;
 *   host?: string;
 *   hostname?: string;
 *   insecureHTTPParser?: boolean;
 *   localAddress?: string;
 *   localPort?: number;
 *   lookup?: Function;
 *   maxHeaderSize?: number;
 *   method?: string;
 *   path?: string;
 *   port?: number;
 *   protocol?: string;
 *   setHost?: boolean;
 *   socketPath?: string;
 *   timeout?: number;
 *   signal?: AbortSignal;
 *   } | string | URL} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function get(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
}

module.exports = {
  Agent,
  globalAgent,
  get,
  request,
};
