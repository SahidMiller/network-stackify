# `network-stackify`

> Network stack ports from native nodejs

This repository is inspired by go-ipfs [experimental p2p streams](https://github.com/ipfs/go-ipfs/blob/master/docs/experimental-features.md#ipfs-p2p). In particular, as a [base socket](https://github.com/SahidMiller/network-stackify/tree/master/packages/libp2p-net) for building HTTP, HTTPS, TLS, and WS implementations over arbitrary [libp2p transports](https://docs.libp2p.io/concepts/transport/), modelling native apis.

## Packages

net modules:

- [libp2p-net](https://github.com/SahidMiller/network-stackify/tree/master/packages/libp2p-net)

http(s) modules:

- [http](https://github.com/SahidMiller/network-stackify/tree/master/packages/http)
- [https](https://github.com/SahidMiller/network-stackify/tree/master/packages/https)
- [tls](https://github.com/SahidMiller/network-stackify/tree/master/packages/tls)

transport modules:

- [ws](https://github.com/SahidMiller/network-stackify/tree/master/packages/ws)

## Examples

The following examples will use google.com for plain http/https and bch.imaginary.cash for ws/wss.

```js
import stack from "network-stackify";

function readResponse(response) {
  var str = "";
  response.on("data", (chunk) => {
    str += chunk;
  });
  response.on("end", () => {
    console.log(str);
  });
}

async function createSocket(client) {
  try {
    await new Promise((resolve, reject) => {
      client.on("upgrade", function () {
        console.log("WebSocket Client Connected");
        resolve();
      });

      client.on("error", function (error) {
        console.log(error.stack);
        console.log("Connection Error: " + error.toString());
        reject(error);
      });
    });
  } catch (error) {
    console.log("Error connecting to remote websocket");
    throw error;
  }

  client.on("close", function () {
    console.log("echo-protocol Connection Closed");
  });

  client.on("message", function (message) {
    console.log("Received: '" + message + "'");
  });

  return client;
}

let libp2p;
async function createPeer() {
  if (libp2p) return libp2p;

  const ipfs = await import("./src/index.js");
  const peer = await ipfs.createPeer();
  libp2p = peer.libp2p;
  return libp2p;
}

// The following examples will demonstrate using stackify's custom http(s) modules.
//   - Each will use native or bundled net and tls modules (since not passing opts.createConnection).
//   - Generally, each supports Agent syntax:
//     - stack.http(s).Agent supports slightly modified for easier passing - new stack.http(s).Agent().

//Working
export function googleHttp() {
  stack.http.request("http://google.com", readResponse).end();
}

//Working
export function googleHttps() {
  stack.https.request("https://google.com", readResponse).end();
}

//Working
export async function websocketHttp() {
  const client = await createSocket(
    new stack.ws("ws://bch.imaginary.cash:50003", {
      get: stack.http.get,
    })
  );

  client.send(
    JSON.stringify({
      method: "blockchain.scripthash.listunspent",
      params: [
        "60e518016f265ca054e7044b818b3438d2886138c15cc7563f24bbe29e0cca91",
      ],
      id: 1,
    })
  );

  return client;
}

//Working
export async function websocketHttps() {
  const client = await createSocket(
    new stack.ws("wss://bch.imaginary.cash:50004", {
      get: stack.https.get,
    })
  );

  client.send(
    JSON.stringify({
      method: "blockchain.scripthash.listunspent",
      params: [
        "60e518016f265ca054e7044b818b3438d2886138c15cc7563f24bbe29e0cca91",
      ],
      id: 1,
    })
  );
}

// The following examples will demonstrate using stackify's custom tls module.
//   - Each will pass opts.createConnection to bypass native or bundled tls module.
//   - Each will use native or bundled net module (since not passing a opts.socket).
//   - Each supports native or custom http(s) implementations for node (native) or browser & node support (stackify)
//   - Generally, each supports Agent syntax:
//     - stack.http(s).Agent supports slightly modified for easier passing - new stack.http(s).Agent({ createConnection }).

//working
export function googleCustomHttps() {
  const createConnection = (opts) => {
    return stack.tls.connect({
      ...opts,
      //TODO God willing: these options are required and can be omitted when using an agent
      // results in EPERM (piping) or TLS errors if not strictly correct
      path: null,
      port: 443,
      servername: "google.com",
      debug: true,
    });
  };

  stack.https
    .request("https://google.com", { createConnection }, readResponse)
    .end();
}

//Working
export async function websocketCustomHttps() {
  const createConnection = (opts) => {
    //tls will use native or bundled net module
    return stack.tls.connect({
      ...opts,
      //TODO God willing: these options are required and can be omitted when using an agent
      // results in EPERM (piping) or TLS errors if not strictly correct
      path: undefined,
      servername: opts.host,
    });
  };

  const client = await createSocket(
    new stack.ws("wss://bch.imaginary.cash:50004", {
      get: stack.https.get,
      //native or stack https will not use native or bundled tls module
      createConnection,
    })
  );

  client.send(
    JSON.stringify({
      method: "blockchain.scripthash.listunspent",
      params: [
        "60e518016f265ca054e7044b818b3438d2886138c15cc7563f24bbe29e0cca91",
      ],
      id: 1,
    })
  );
}

// The following examples will demonstrate using stackify's custom net module using libp2p.
//   - Each will pass opts.createConnection to bypass native or bundled net and tls modules.
//   - Each will pass opts.socket to bypass native or bundled net module when using tls.
//   - Each supports native or custom http(s) implementations for node (native) or browser & node support (stackify)
//   - Each supports native or custom tls implementation for node (native) or browser & node support (stackify)
//   - Generally, each supports Agent syntax:
//     - stack.http(s).Agent supports slightly modified for easier passing - new stack.http(s).Agent({ createConnection }).

const peerId = "";

//Browser requires: /dns4/localhost/tcp/443/wss
const multiaddr = "/dns4/localhost/tcp/4003/ws/p2p/" + peerId;

//Working
//ipfs p2p listen /x/httpGoogle /dns4/google.com/tcp/80
export async function googleCustomLibp2pHttp() {
  const libp2p = await createPeer();
  //common pitfall is mismatch between url and http(s)
  stack.http
    .request(
      "http://google.com",
      {
        createConnection: stack.net.connect,
        libp2p,
        multiaddr,
        hops: [],
        proto: "/x/httpGoogle",
      },
      readResponse
    )
    .end();
}

//working
//ipfs p2p listen /x/httpsGoogle /dns4/google.com/tcp/443
export async function googleCustomLibp2pHttps() {
  const libp2p = await createPeer();

  const createConnection = (opts) => {
    const socket = stack.net.connect(opts);

    return stack.tls.connect({
      ...opts,
      socket,
      //TODO God willing: these options are required and can be omitted when using an agent
      // results in EPERM (piping) or TLS errors if not strictly correct
      path: undefined,
      port: 443,
      servername: "google.com",
    });
  };

  //common pitfall is mismatch between url and http(s)
  stack.https
    .request(
      "https://google.com",
      {
        createConnection,
        libp2p,
        multiaddr,
        hops: [],
        //Common pitfall is mismatch between url and proto. This is caught by https.
        proto: "/x/httpsGoogle",
      },
      readResponse
    )
    .end();
}

//Working
//ipfs p2p listen /x/httpElectrum /dns4/bch.imaginary.cash/tcp/50003
export async function websocketCustomLibp2pHttp() {
  const libp2p = await createPeer();

  let client = await createSocket(
    new stack.ws("http://bch.imaginary.cash:50003", {
      get: stack.http.get,
      createConnection: stack.net.createConnection,
      libp2p,
      multiaddr:
        "/dns4/localhost/tcp/4003/ws/p2p/12D3KooWGEpMXtVT1rUZuACbjaE3mGz2jkzNdnJgM7eSfb5JVPVz",
      hops: [],
      proto: "/x/httpElectrum",
    })
  );

  client.send(
    JSON.stringify({
      method: "blockchain.scripthash.listunspent",
      params: [
        "60e518016f265ca054e7044b818b3438d2886138c15cc7563f24bbe29e0cca91",
      ],
      id: 1,
    })
  );
}

//Working
//ipfs p2p listen /x/httpsElectrum /dns4/bch.imaginary.cash/tcp/50004
export async function websocketCustomLibp2pHttps() {
  const libp2p = await createPeer();

  const createConnection = (opts) => {
    const socket = stack.net.createConnection(opts);
    return stack.tls.connect({ ...opts, socket });
  };

  let client = await createSocket(
    new stack.ws("https://bch.imaginary.cash:50004", {
      get: stack.https.get,
      createConnection,
      libp2p,
      multiaddr:
        "/dns4/localhost/tcp/4003/ws/p2p/12D3KooWGEpMXtVT1rUZuACbjaE3mGz2jkzNdnJgM7eSfb5JVPVz",
      hops: [],
      proto: "/x/httpsElectrum",
      debug: true,
    })
  );

  client.send(
    JSON.stringify({
      method: "blockchain.scripthash.listunspent",
      params: [
        "60e518016f265ca054e7044b818b3438d2886138c15cc7563f24bbe29e0cca91",
      ],
      id: 1,
    })
  );
}
```
