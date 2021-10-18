import { Duplex } from "stream";
import getIterator from "get-iterator";
import Fifo from "p-fifo";
import { Buffer } from "buffer";
const END_CHUNK = Buffer.alloc(0);

import buffer from "it-buffer";
import {
  normalizedArgsSymbol,
  _normalizeArgs,
} from "@network-stackify/stack/utils/net.js";

/**
 * Convert async iterator stream to socket
 * @param {Object} options options.stream: required to convert to a socket
 * @returns {Socket} socket like class using underlying stream
 */
function Socket(options) {
  options = options || {};

  if (!(this instanceof Socket)) return new Socket(options);

  //TODO God willing: Implement required net.Socket convensions, setTimeout
  this.setTimeout = () => {};
  this.setNoDelay = () => {};
  this.setKeepAlive = () => {};
  this.ref = () => {};
  this.unref = () => {};
  this.connecting = false;
  this.stream = options.stream;

  this._read = function() {}

  this._write = function(data, enc, done) {
    if (this.stream) {
      this.stream.write(data, enc, done);
    } else {
      done()
    }
  }

  this._destroy = function(err, cb) {
    try {
      
      if (this.stream) {
        this.stream.destroy(err, cb);
      }

      Duplex.prototype.destroy.call(this, err, cb)

    } catch (err) {
      cb();
    }
  }

  if (this.stream) {
    this.stream.on("data", (data) => {
      this.push(data)
    });

    this.stream.on("end", () => {
      this.push(null);
    })
  }

  Duplex.call(this, options);
}

Object.setPrototypeOf(Socket.prototype, Duplex.prototype);
Object.setPrototypeOf(Socket, Duplex);

Socket.prototype.connect = function(...args) {
  let normalized;
  // If passed an array, it's treated as an array of arguments that have
  // already been normalized (so we don't normalize more than once). This has
  // been solved before in https://github.com/nodejs/node/pull/12342, but was
  // reverted as it had unintended side effects.
  if (Array.isArray(args[0]) && args[0][normalizedArgsSymbol]) {
    normalized = args[0];
  } else {
    normalized = _normalizeArgs(args);
  }

  const options = normalized[0];
  const cb = normalized[1];

  if (cb !== null) {
    this.once("connect", cb);
  }
  const connectFn = this.internalConnect || options.connect

  if (!connectFn) {
    throw new Error("No connect method. Implement this.internalConnect or pass options.connect");
  }

  connectFn.call(this, options, cb);

  return this;
}

/**
 *
 * @param {*} multiaddr multiaddress of libp2p proxy
 * @param {*} proto p2p protocol name
 * @returns
 */
function connect(...args) {
  const normalized = _normalizeArgs(args);
  const [options] = normalized;

  if (options.timeout) {
    socket.setTimeout(options.timeout);
  }

  const socket = new Socket(options);
  return socket.connect(normalized);
}

export { Socket, connect };
