const { Duplex } = require("stream");
const getIterator = require("get-iterator");
const Fifo = require("p-fifo");
const { Buffer } = require("buffer");
const END_CHUNK = Buffer.alloc(0);

const buffer = require("it-buffer");
const getCircuitRelay = require("./circuit-relay");
const {
  normalizeArgs,
  normalizedArgsSymbol,
} = require("@network-stackify/utils");

/**
 * Convert async iterator stream to socket
 * @param {Object} options options.stream: required to convert to a socket
 * @returns {Socket} socket like class using underlying stream
 */
class Socket extends Duplex {
  constructor(options) {
    options = options || {};
    let self = this;
    let reading = false;
    let fifo = new Fifo();

    const readable = {
      async read(size) {
        if (reading) return;
        reading = true;

        try {
          while (true) {
            //TODO God willing: if no duplex, then not connected yet, so either wait to read or return nothing.
            const { value, done } = await self.duplex.source.next(size);
            if (done) return this.push(null);
            if (!this.push(value)) break;
          }
        } catch (err) {
          this.emit("error", err);
        } finally {
          reading = false;
        }
      },
    };

    const writable = {
      write(chunk, enc, cb) {
        fifo.push(chunk).then(() => cb(), cb);
      },
      final(cb) {
        fifo.push(END_CHUNK).then(() => cb(), cb);
      },
    };

    Object.assign(options, readable, writable);

    super(options);

    this.fifo = fifo;
    //TODO God willing: Implement required net.Socket convensions, setTimeout
    this.setTimeout = () => {};
    this.setNoDelay = () => {};

    this.readyState = "closed";
    this.connecting = false;
  }

  async _connect({ libp2p, multiaddr, proto, hops }) {
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

    this.emit("connect");
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
      normalized = normalizeArgs(args);
    }

    const options = normalized[0];
    const cb = normalized[1];

    if (cb !== null) {
      this.once("connect", cb);
    }

    //TODO God willing: parse hops and protocols from multiaddress
    this._connect(options);

    return this;
  }
}

/**
 *
 * @param {*} multiaddr multiaddress of libp2p proxy
 * @param {*} proto p2p protocol name
 * @returns
 */
async function connect(...args) {
  const normalized = normalizeArgs(args);
  const [options] = normalized;

  if (options.timeout) {
    socket.setTimeout(options.timeout);
  }

  const socket = new Socket(options);
  return socket.connect(normalized);
}

//TODO God willing: add similar isIP, isIPv4/6 types for multiaddresses and hops
//TODO God willing: blocklist and Server could be useful.
module.exports = {
  connect,
  createConnection: connect,
  Socket,
  Stream: Socket,
  _normalizeArgs: normalizeArgs,
};
