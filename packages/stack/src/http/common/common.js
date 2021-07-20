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

const { setImmediate } = require("timers");

const FreeList = require("./internal/freelist");
const incoming = require("./incoming");
const { IncomingMessage, readStart, readStop } = incoming;

let debug = require("util").debuglog("http", (fn) => {
  debug = fn;
});

const kIncomingMessage = Symbol("IncomingMessage");
const kRequestTimeout = Symbol("RequestTimeout");
const kOnExecute = 0;
const kOnTimeout = 0;

const MAX_HEADER_PAIRS = 2000;

// `headers` and `url` are set only if .onHeaders() has not been called for
// this request.
// `url` is not set for response parsers but that's not applicable here since
// all our parsers are request parsers.
function parserOnHeadersComplete(
  versionMajor,
  versionMinor,
  headers,
  rawHeaders,
  method,
  url,
  statusCode,
  statusMessage,
  upgrade,
  shouldKeepAlive
) {
  const parser = this;
  const { socket } = parser;

  if (headers === undefined) {
    headers = parser._headers;
    parser._headers = [];
  }

  if (url === undefined) {
    url = parser._url;
    parser._url = "";
  }

  // Parser is also used by http client
  const ParserIncomingMessage =
    (socket && socket.server && socket.server[kIncomingMessage]) ||
    IncomingMessage;

  const incoming = (parser.incoming = new ParserIncomingMessage(socket));
  incoming.httpVersionMajor = versionMajor;
  incoming.httpVersionMinor = versionMinor;
  incoming.httpVersion = `${versionMajor}.${versionMinor}`;
  incoming.url = url;
  incoming.upgrade = upgrade;

  if (socket) {
    debug("requestTimeout timer moved to req");
    incoming[kRequestTimeout] = incoming.socket[kRequestTimeout];
    incoming.socket[kRequestTimeout] = undefined;
  }

  incoming.headers = headers || {};
  incoming.rawHeaders = rawHeaders || [];

  if (typeof method === "number") {
    // server only
    incoming.method = methods[method];
  } else {
    // client only
    incoming.statusCode = statusCode;
    incoming.statusMessage = statusMessage;
  }

  return parser.onIncoming(incoming, shouldKeepAlive);
}

function parserOnBody(b, start, len) {
  const stream = this.incoming;

  // If the stream has already been removed, then drop it.
  if (stream === null) return;

  // Pretend this was the result of a stream._read call.
  if (len > 0 && !stream._dumped) {
    const slice = b.slice(start, start + len);
    const ret = stream.push(slice);
    if (!ret) readStop(this.socket);
  }
}

function parserOnMessageComplete() {
  const parser = this;
  const stream = parser.incoming;

  if (stream !== null) {
    stream.complete = true;
    // Emit any trailing headers.
    const headers = parser._headers;
    if (headers.length) {
      stream._addHeaderLines(headers, headers.length);
      parser._headers = [];
      parser._url = "";
    }
    // For emit end event
    stream.push(null);
  }

  // Force to read the next incoming message
  readStart(parser.socket);
}

const util = require("node-forge/lib/util");
const http = require("node-forge/lib/http");

class HTTPParser {
  initialize() {
    this._response = http.createResponse();
  }

  //On data call back for parsing
  execute(data) {
    const read = this.tryParseHeaders(data) || 0;

    if (this.tryParseBody(data, read)) {
      parserOnMessageComplete.call(this);
    }

    return data.length;
  }

  tryParseHeaders(data) {
    const response = this._response;

    if (!response.headerReceived) {
      const buffer = util.createBuffer();
      buffer.putBytes(data);

      response.readHeader(buffer);

      if (response.headerReceived) {
        let httpVersionMajor, httpVersionMinor;

        //Parse version
        if (response.version) {
          const version = response.version.split("/")[1];
          const [majorVersion, minorVersion] = version.split(".");

          httpVersionMajor = Number(majorVersion);
          httpVersionMinor = Number(minorVersion);
        }

        //Parse headers
        const headers = {};
        const rawHeaders = [];
        const kHeaders = Object.keys(response.fields);

        for (let i = 0; i < kHeaders.length; i++) {
          const kHeader = kHeaders[i];
          const vHeader = response.getField(kHeader);

          headers[kHeader.toLowerCase()] = vHeader;
          rawHeaders.push(kHeader);
          if (vHeader instanceof Array) {
            vHeader.forEach((v) => rawHeaders.push(vHeader));
          } else {
            rawHeaders.push(vHeader);
          }
        }

        //Send to http/https agent
        const connection = response.getField("connection") || "";
        const upgrade = connection.toLowerCase() === "upgrade";
        const keepAlive = response.getField("Keep-Alive") !== null;

        parserOnHeadersComplete.call(
          this,
          httpVersionMajor,
          httpVersionMinor,
          headers,
          rawHeaders,
          null,
          "",
          response.message,
          response.code,
          upgrade,
          keepAlive
        );

        //Headers for parsing body
        let contentLength = response.getField("Content-Length");
        const transferEncoding = response.getField("Transfer-Encoding");
        const contentType = response.getField("Content-Type");

        if (contentLength !== null) {
          contentLength = parseInt(contentLength);
        }

        this._response = {
          headerReceived: true,
          bodyReceived: false,
          contentLength: contentLength,
          transferEncoding: transferEncoding,
          contentType: contentType,
          headerReceived: true,
          bodyBytesParsed: 0,
        };

        return buffer.read;
      }
    }

    return 0;
  }

  tryParseBody(data, start) {
    const response = this._response;

    //Return if body is already parsed
    if (response.bodyReceived || !response.headerReceived) {
      return;
    }

    const contentLength = response.contentLength;

    // read specified length
    const shouldReadContentLength =
      contentLength !== null && contentLength >= 0;

    // no content-length, read until close
    const shouldReadUntilClose =
      (contentLength !== null && contentLength < 0) ||
      (contentLength === null && response.contentType !== null);

    if (shouldReadContentLength) {
      this.readContentLength(data, start);
    } else if (shouldReadUntilClose) {
      this.readUntilFinished(data, start);
    } else {
      response.bodyReceived = true;
    }

    return response.bodyReceived;
  }

  readContentLength(data, start) {
    parserOnBody.call(this, data, start, data.length);

    const response = this._response;
    response.bodyBytesParsed = response.bodyBytesParsed + (data.length - start);
    response.bodyReceived = response.bodyBytesParsed === response.contentLength;
  }

  readUntilFinished(data, start) {
    parserOnBody.call(this, data, start, data.length);

    if (!this._response.readBodyUntilClose) {
      this.socket.on("close", () => {
        parserOnMessageComplete.call(this);
      });
    }

    this._response.readBodyUntilClose = true;
  }

  finish() {
    //Called in socketOnData http_client
    this._response = null;
  }

  free() {
    //Called by freeParser in http_common and socketOnData in http_client
  }
}

const parsers = new FreeList("parsers", 1000, function parsersCb() {
  //TODO God willing: while reading response, inherit incoming, God willing, emit correct events
  const parser = new HTTPParser();
  cleanParser(parser);

  return parser;
});

function closeParserInstance(parser) {
  parser.close();
}

// Free the parser and also break any links that it
// might have to any other things.
// TODO: All parser data should be attached to a
// single object, so that it can be easily cleaned
// up by doing `parser.data = {}`, which should
// be done in FreeList.free.  `parsers.free(parser)`
// should be all that is needed.
function freeParser(parser, req, socket) {
  if (parser) {
    if (parser._consumed) parser.unconsume();
    cleanParser(parser);
    if (parsers.free(parser) === false) {
      // Make sure the parser's stack has unwound before deleting the
      // corresponding C++ object through .close().
      setImmediate(closeParserInstance, parser);
    } else {
      // Since the Parser destructor isn't going to run the destroy() callbacks
      // it needs to be triggered manually.
      parser.free();
    }
  }
  if (req) {
    req.parser = null;
  }
  if (socket) {
    socket.parser = null;
  }
}

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
/**
 * Verifies that the given val is a valid HTTP token
 * per the rules defined in RFC 7230
 * See https://tools.ietf.org/html/rfc7230#section-3.2.6
 */
function checkIsHttpToken(val) {
  return tokenRegExp.test(val);
}

const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
/**
 * True if val contains an invalid field-vchar
 *  field-value    = *( field-content / obs-fold )
 *  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 *  field-vchar    = VCHAR / obs-text
 */
function checkInvalidHeaderChar(val) {
  return headerCharRegex.test(val);
}

function cleanParser(parser) {
  parser._headers = [];
  parser._url = "";
  parser.socket = null;
  parser.incoming = null;
  parser.outgoing = null;
  parser.maxHeaderPairs = MAX_HEADER_PAIRS;
  parser[kOnExecute] = null;
  parser[kOnTimeout] = null;
  parser._consumed = false;
  parser.onIncoming = null;
}

function prepareError(err, parser, rawPacket) {
  err.rawPacket = rawPacket || parser.getCurrentBuffer();
  if (typeof err.reason === "string")
    err.message = `Parse Error: ${err.reason}`;
}

function isLenient() {
  return false;
}

module.exports = {
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  _checkIsHttpToken: checkIsHttpToken,
  chunkExpression: /(?:^|\W)chunked(?:$|\W)/i,
  continueExpression: /(?:^|\W)100-continue(?:$|\W)/i,
  CRLF: "\r\n",
  freeParser,
  parsers,
  kIncomingMessage,
  kRequestTimeout,
  isLenient,
  prepareError,
};
