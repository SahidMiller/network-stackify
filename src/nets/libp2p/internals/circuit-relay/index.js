import StreamHandler from "./stream-handler.js";
import CircuitPB from "./circuit-pb.js";
const { Type, Status } = CircuitPB
import { createFromCID } from "peer-id";
import { Multiaddr } from "multiaddr";
import toConnection from "libp2p-utils/src/stream-to-ma-conn.js";

const PROTOCOL = "/libp2p/circuit/relay/0.1.0";
export default async function getCircuitRelay(
  libp2p,
  connection,
  destinationId
) {
  const { stream } = await connection.newStream(PROTOCOL);
  const destinationPeer = createFromCID(destinationId);

  const streamHandler = new StreamHandler({ stream });
  streamHandler.write({
    type: Type.HOP,
    srcPeer: {
      id: libp2p.peerId.toBytes(),
      addrs: [],
    },
    dstPeer: {
      id: destinationPeer.toBytes(),
      addrs: [new Multiaddr("/p2p/" + destinationPeer.toB58String()).bytes],
    },
  });

  const response = await streamHandler.read();
  if (response && response.code === Status.SUCCESS) {
    const vStream = streamHandler.rest();
    const maConn = toConnection({
      stream: vStream,
      remoteAddr: connection.remoteAddr.encapsulate(
        `/p2p-circuit/p2p/${destinationId}`
      ),
      localAddr: connection.remoteAddr.encapsulate(
        `/p2p-circuit/p2p/${libp2p.peerId.toB58String()}`
      ),
    });
    return await libp2p.upgrader.upgradeOutbound(maConn);
  }
}
