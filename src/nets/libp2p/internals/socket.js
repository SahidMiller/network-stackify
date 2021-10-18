import { Socket } from "../../generic/internals/socket.js"
import getCircuitRelay from "./circuit-relay/index.js";
import { _normalizeArgs } from "@network-stackify/stack/utils/net.js";
import { Duplex } from "stream";
import getIterator from "get-iterator";
import Fifo from "p-fifo";
import { Buffer } from "buffer";
import buffer from "it-buffer";

const END_CHUNK = Buffer.alloc(0);

/**
 * Convert async iterator stream to socket
 * @param {Object} options options.stream: required to convert to a socket
 * @returns {Socket} socket like class using underlying stream
 */
function Libp2pSocket(options) {
  if (!(this instanceof Libp2pSocket)) return new Libp2pSocket(options);
  Socket.call(this, options);
}

Object.setPrototypeOf(Libp2pSocket.prototype, Socket.prototype);
Object.setPrototypeOf(Libp2pSocket, Socket);

Libp2pSocket.prototype.internalConnect = async function({ libp2p, multiaddr, proto, hops }) {
  try {
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
        
    const fifo = new Fifo();
    const source = getIterator(buffer(stream.source))
    const sink = stream.sink;

    this.stream = new Duplex();
    this.stream._read = async function (size) {
      const { value, done } = await source.next(size);
      done ? this.push(null) : this.push(value);
    }
    this.stream._write = function(data, enc, done) {
      fifo.push(data).then(() => done(), done);
    }
    this.stream._destroy = function(err, done) {
      err ? stream.abort(err) : stream.close();
    }
    this.stream.on("data", (data) => {
      this.push(data)
    });
    this.stream.on("end", () => {
      this.push(null);
    })
    
    sink({
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        const chunk = await fifo.shift();
        return chunk === END_CHUNK ? { done: true } : { value: chunk };
      },
      async throw(err) {
        this.stream.destroy(err);
        return { done: true };
      },
      async return() {
        this.stream.destroy();
        return { done: true };
      },
    });

    process.nextTick(() => this.emit("connect"));
  
  } catch (err) {

    debugger;
    this.destroy(err);
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

  const socket = new Libp2pSocket(options);
  return socket.connect(normalized);
}


export { Libp2pSocket as Socket, connect };
