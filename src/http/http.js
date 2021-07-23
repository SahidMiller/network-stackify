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

import { Agent as _Agent, globalAgent } from "./common/agent";
import { ClientRequest } from "./common/client";
import { IncomingMessage } from "./common/incoming";
import {
  validateHeaderName,
  validateHeaderValue,
  OutgoingMessage,
} from "./common/outgoing";
import {
  _connectionListener,
  STATUS_CODES,
  Server,
  ServerResponse,
} from "./common/server";

let maxHeaderSize;

/**
 * Returns a new instance of `http.Server`.
 * @param {{
 *   IncomingMessage?: IncomingMessage;
 *   ServerResponse?: ServerResponse;
 *   insecureHTTPParser?: boolean;
 *   maxHeaderSize?: number;
 *   }} [opts]
 * @param {Function} [requestListener]
 * @returns {Server}
 */
function createServer(opts, requestListener) {
  return new Server(opts, requestListener);
}

/**
 * @typedef {Object} HTTPRequestOptions
 * @property {httpAgent.Agent | boolean} [agent]
 * @property {string} [auth]
 * @property {Function} [createConnection]
 * @property {number} [defaultPort]
 * @property {number} [family]
 * @property {Object} [headers]
 * @property {number} [hints]
 * @property {string} [host]
 * @property {string} [hostname]
 * @property {boolean} [insecureHTTPParser]
 * @property {string} [localAddress]
 * @property {number} [localPort]
 * @property {Function} [lookup]
 * @property {number} [maxHeaderSize]
 * @property {string} [method]
 * @property {string} [path]
 * @property {number} [port]
 * @property {string} [protocol]
 * @property {boolean} [setHost]
 * @property {string} [socketPath]
 * @property {number} [timeout]
 * @property {AbortSignal} [signal]
 */

/**
 * Makes an HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}

/**
 * Makes a `GET` HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function get(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
}
const METHODS = [
  "ACL",
  "BIND",
  "CHECKOUT",
  "CONNECT",
  "COPY",
  "DELETE",
  "GET",
  "HEAD",
  "LINK",
  "LOCK",
  "M-SEARCH",
  "MERGE",
  "MKACTIVITY",
  "MKCALENDAR",
  "MKCOL",
  "MOVE",
  "NOTIFY",
  "OPTIONS",
  "PATCH",
  "POST",
  "PRI",
  "PROPFIND",
  "PROPPATCH",
  "PURGE",
  "PUT",
  "REBIND",
  "REPORT",
  "SEARCH",
  "SOURCE",
  "SUBSCRIBE",
  "TRACE",
  "UNBIND",
  "UNLINK",
  "UNLOCK",
  "UNSUBSCRIBE",
];

export {
  METHODS,
  STATUS_CODES,
  _Agent as Agent,
  ClientRequest,
  IncomingMessage,
  OutgoingMessage,
  Server,
  ServerResponse,
  createServer,
  _connectionListener,
  validateHeaderName,
  validateHeaderValue,
  get,
  request,
};

Object.defineProperty(module.exports, "maxHeaderSize", {
  configurable: true,
  enumerable: true,
  get() {
    if (maxHeaderSize === undefined) {
      maxHeaderSize = 15000;
    }

    return maxHeaderSize;
  },
});

Object.defineProperty(module.exports, "globalAgent", {
  configurable: true,
  enumerable: true,
  get() {
    return globalAgent;
  },
  set(value) {
    globalAgent = value;
  },
});
