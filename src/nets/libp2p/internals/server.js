import { Server, normalizeArgs } from "../../generic/internals/server.js"

import { codes } from "@network-stackify/stack/utils/errors.js";
const { ERR_INVALID_ARG_VALUE } = codes;

import { debuglog } from "util"
let debug = debuglog("net", (fn) => {
  debug = fn;
});

function Libp2pServer(options, requestListener) {
  if (!(this instanceof Libp2pServer)) return new Libp2pServer(options, requestListener);
  Server.call(this, options, requestListener);
}

Object.setPrototypeOf(Libp2pServer.prototype, Server.prototype);
Object.setPrototypeOf(Libp2pServer, Server);

Libp2pServer.prototype.internalListen = function(options, cb) {

  if (!("protocol" in options)) {
    throw new ERR_INVALID_ARG_VALUE(
      "options",
      options,
      'must have the property "protocol"'
    );
  }

  if (!("libp2p" in options)) {
    throw new ERR_INVALID_ARG_VALUE(
      "options",
      options,
      'must have the property "libp2p"'
    );
  }

  const self = this;
  this._ma = options.libp2p.peerId.toB58String();
  this._protocol =
    options.protocol[0] === "/" ? options.protocol : "/" + options.protocol;
  this._port = options.port;

  options.libp2p.handle(this._protocol, ({ connection, stream, protocol }) => {
    console.log(connection, stream, protocol);
    self.addConnection(stream);
  });

  //TODO God willing: ipfs.libp2p.unhandle and watch if ipfs/libp2p close, God willing.

  this.listening = true;
  this.emit("listening");
};

Libp2pServer.prototype.internalAddress = function() {
  if (this.listening) {
    return { address: this._ma, family: "LIBP2P", protocol: this._protocol, port: this._port };
  }

  return null;
};

function createServer(options, connectionListener) {
  return new Libp2pServer(options, connectionListener);
}

export { Libp2pServer as Server, createServer, normalizeArgs };
