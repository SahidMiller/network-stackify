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

const httpAgent = require("./http-client/agent");
const { ClientRequest } = require("./http-client");
const { methods } = require("./http-client/common");
const { IncomingMessage } = require("./http-client/incoming");
const {
  validateHeaderName,
  validateHeaderValue,
  OutgoingMessage,
} = require("./http-client/outgoing");

let maxHeaderSize;

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

module.exports = {
  METHODS: [
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
  ],
  STATUS_CODES: {
    100: "Continue", // RFC 7231 6.2.1
    101: "Switching Protocols", // RFC 7231 6.2.2
    102: "Processing", // RFC 2518 10.1 (obsoleted by RFC 4918)
    103: "Early Hints", // RFC 8297 2
    200: "OK", // RFC 7231 6.3.1
    201: "Created", // RFC 7231 6.3.2
    202: "Accepted", // RFC 7231 6.3.3
    203: "Non-Authoritative Information", // RFC 7231 6.3.4
    204: "No Content", // RFC 7231 6.3.5
    205: "Reset Content", // RFC 7231 6.3.6
    206: "Partial Content", // RFC 7233 4.1
    207: "Multi-Status", // RFC 4918 11.1
    208: "Already Reported", // RFC 5842 7.1
    226: "IM Used", // RFC 3229 10.4.1
    300: "Multiple Choices", // RFC 7231 6.4.1
    301: "Moved Permanently", // RFC 7231 6.4.2
    302: "Found", // RFC 7231 6.4.3
    303: "See Other", // RFC 7231 6.4.4
    304: "Not Modified", // RFC 7232 4.1
    305: "Use Proxy", // RFC 7231 6.4.5
    307: "Temporary Redirect", // RFC 7231 6.4.7
    308: "Permanent Redirect", // RFC 7238 3
    400: "Bad Request", // RFC 7231 6.5.1
    401: "Unauthorized", // RFC 7235 3.1
    402: "Payment Required", // RFC 7231 6.5.2
    403: "Forbidden", // RFC 7231 6.5.3
    404: "Not Found", // RFC 7231 6.5.4
    405: "Method Not Allowed", // RFC 7231 6.5.5
    406: "Not Acceptable", // RFC 7231 6.5.6
    407: "Proxy Authentication Required", // RFC 7235 3.2
    408: "Request Timeout", // RFC 7231 6.5.7
    409: "Conflict", // RFC 7231 6.5.8
    410: "Gone", // RFC 7231 6.5.9
    411: "Length Required", // RFC 7231 6.5.10
    412: "Precondition Failed", // RFC 7232 4.2
    413: "Payload Too Large", // RFC 7231 6.5.11
    414: "URI Too Long", // RFC 7231 6.5.12
    415: "Unsupported Media Type", // RFC 7231 6.5.13
    416: "Range Not Satisfiable", // RFC 7233 4.4
    417: "Expectation Failed", // RFC 7231 6.5.14
    418: "I'm a Teapot", // RFC 7168 2.3.3
    421: "Misdirected Request", // RFC 7540 9.1.2
    422: "Unprocessable Entity", // RFC 4918 11.2
    423: "Locked", // RFC 4918 11.3
    424: "Failed Dependency", // RFC 4918 11.4
    425: "Too Early", // RFC 8470 5.2
    426: "Upgrade Required", // RFC 2817 and RFC 7231 6.5.15
    428: "Precondition Required", // RFC 6585 3
    429: "Too Many Requests", // RFC 6585 4
    431: "Request Header Fields Too Large", // RFC 6585 5
    451: "Unavailable For Legal Reasons", // RFC 7725 3
    500: "Internal Server Error", // RFC 7231 6.6.1
    501: "Not Implemented", // RFC 7231 6.6.2
    502: "Bad Gateway", // RFC 7231 6.6.3
    503: "Service Unavailable", // RFC 7231 6.6.4
    504: "Gateway Timeout", // RFC 7231 6.6.5
    505: "HTTP Version Not Supported", // RFC 7231 6.6.6
    506: "Variant Also Negotiates", // RFC 2295 8.1
    507: "Insufficient Storage", // RFC 4918 11.5
    508: "Loop Detected", // RFC 5842 7.2
    509: "Bandwidth Limit Exceeded",
    510: "Not Extended", // RFC 2774 7
    511: "Network Authentication Required", // RFC 6585 6
  },
  Agent: httpAgent.Agent,
  ClientRequest,
  IncomingMessage,
  OutgoingMessage,
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
    return httpAgent.globalAgent;
  },
  set(value) {
    httpAgent.globalAgent = value;
  },
});
