//TODO God willing: add similar isIP, isIPv4/6 types for multiaddresses and hops
//TODO God willing: blocklist and Server could be useful.

import { Server, createServer, normalizeArgs as normalizeServerArgs } from "./internals/server.js";
import { Socket, connect } from "./internals/socket.js";
export * from "@network-stackify/stack/utils/net.js";

import * as self from "./index.js";
export default self;

export {
  connect,
  connect as createConnection,
  Socket,
  Socket as Stream,
  Server,
  createServer,
  normalizeServerArgs
};
