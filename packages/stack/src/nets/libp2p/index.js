//TODO God willing: add similar isIP, isIPv4/6 types for multiaddresses and hops
//TODO God willing: blocklist and Server could be useful.

const { Server, createServer } = require("./server");
const { Socket, connect } = require("./socket");
const net = require("../../utils/net");

module.exports = {
  connect,
  createConnection: connect,
  Socket,
  Stream: Socket,
  ...net,
  Server,
  createServer,
};
