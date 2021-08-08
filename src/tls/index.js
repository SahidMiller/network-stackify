import rootCertificates from "./internals/rootCertificates.js";
import { checkServerIdentity } from "./internals/checkServerIdentity.js";
import { TLSSocket, connect } from "./internals/socket.js";
import { Server, createServer } from "./internals/server.js";

import * as self from "./index.js";

export default self;

export {
  checkServerIdentity,
  TLSSocket,
  connect,
  Server,
  createServer,
  rootCertificates,
};
