//TODO God willing: add similar isIP, isIPv4/6 types for multiaddresses and hops
//TODO God willing: blocklist and Server could be useful.

import { Server, createServer } from "./internals/server";
import { Socket, connect } from "./internals/socket";
export * as net from "@network-stackify/stack/utils/net";

export {
  connect,
  connect as createConnection,
  Socket,
  Socket as Stream,
  Server,
  createServer,
};
