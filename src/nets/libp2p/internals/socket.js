import { Duplex } from "stream";
import getIterator from "get-iterator";
import Fifo from "p-fifo";
import { Buffer } from "buffer";
const END_CHUNK = Buffer.alloc(0);

import buffer from "it-buffer";
import getCircuitRelay from "./circuit-relay/index.js";
import {
  normalizedArgsSymbol,
  _normalizeArgs,
} from "@network-stackify/stack/utils/net.js";

/**
 * Convert async iterator stream to socket
 * @param {Object} options options.stream: required to convert to a socket
 * @returns {Socket} socket like class using underlying stream
 */
class Socket extends Duplex {
  constructor(options) {
    options = options || {};

    super(options);

    this.reading = false;
    this.fifo = new Fifo();

    //TODO God willing: Implement required net.Socket convensions, setTimeout
    this.setTimeout = () => {};
    this.setNoDelay = () => {};

    if (options.stream) {
      this.initStream(options.stream);
    }

    this.connecting = false;
  }

  _write(chunk, enc, cb) {
    this.fifo.push(chunk).then(() => cb(), cb);
  }

  _final(cb) {
    this.fifo.push(END_CHUNK).then(() => cb(), cb);
  }

  async _read(size) {
    if (this.connecting || !this.duplex) {
      this.once("connect", () => this._read(size));
      return;
    }

    if (this.reading) return;

    this.reading = true;

    try {
      while (true) {
        //TODO God willing: if no duplex, then not connected yet, so either wait to read or return nothing.
        const { value, done } = await this.duplex.source.next(size);
        if (done) return this.push(null);
        if (!this.push(value)) break;
      }
    } catch (err) {
      this.emit("error", err);
    } finally {
      this.reading = false;
    }
  }

  async internalConnect({ libp2p, multiaddr, proto, hops }) {
    if (!libp2p) {
      throw new Error("Invalid arguments. 'options.libp2p' is required");
    }

    if (!multiaddr) {
      throw new Error("Invalid arguments. 'options.multiaddr' is required");
    }

    if (!proto) {
      throw new Error("Invalid arguments. 'options.proto' is required");
    }

    hops = typeof hops === "string" ? [hops] : hops || [];

    //Attempt to connect to first node using multiaddress
    let connection = await libp2p.dial(multiaddr);

    for (let i = 0; i < hops.length; i++) {
      //Attempt to hop from connection to connection using circuit-relay protocol
      connection = await getCircuitRelay(libp2p, connection, hops[i]);
    }

    //Attempt to connect to protocol on "exit node"
    const { stream } = connection && (await connection.newStream(proto));

    if (!stream) {
      //TODO God willing: replicate net.connect/createConnection errors and warnings
      throw new Error("Failed to connect to remote");
    }

    this.initStream(stream);

    this.emit("connect");
  }

  initStream(stream) {
    const duplex = {
      sink: stream.sink,
      source: stream.source ? getIterator(buffer(stream.source)) : null,
    };

    if (duplex.sink) {
      const self = this;

      duplex.sink({
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          const chunk = await self.fifo.shift();
          return chunk === END_CHUNK ? { done: true } : { value: chunk };
        },
        async throw(err) {
          self.destroy(err);
          return { done: true };
        },
        async return() {
          self.destroy();
          return { done: true };
        },
      });
    }

    this.duplex = duplex;
    return this;
  }

  get readyState() {
    if (this.connecting) {
      return "opening";
    } else if (this.readable && this.writable) {
      return "open";
    } else if (this.readable && !this.writable) {
      return "readOnly";
    } else if (!this.readable && this.writable) {
      return "writeOnly";
    }
    return "closed";
  }

  connect(...args) {
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

    //TODO God willing: parse hops and protocols from multiaddress
    this.internalConnect(options);

    return this;
  }
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
