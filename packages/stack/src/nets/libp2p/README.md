# `@network-stackify/libp2p-net`

> Drop in replacement for net module

## Usage

This module is inspired by go-ipfs [experimental p2p streams](https://github.com/ipfs/go-ipfs/blob/master/docs/experimental-features.md#ipfs-p2p).

Generally, you will need a go-ipfs node to expose a port through libp2p

```
ipfs p2p listen /x/<host> /dns4/<host-fqdn>/tcp/80
```

In nodejs, use like the native net module:

HTTP

```js
const net = require("@network-stackify/libp2p-net");
const http = require("http"); //require('@network-stackify/http')

function readResponse(response) {
  var str = "";
  response.on("data", (chunk) => {
    str += chunk;
  });
  response.on("end", () => {
    console.log(str);
  });
}

const exampleMultiaddr = "/dns4/localhost/tcp/4003/ws/p2p/" + peerId;
const libp2p = await createLibp2pInstance(opts);

//The following options are required but can be omitted when using an agent
// results in EPERM (piping) or TLS errors if not strictly correct
const tlsOptions = {
  path: undefined,
  port: 443,
  servername: "google.com",
};

//go-ipfs: ipfs p2p listen /x/httpGoogle /dns4/google.com/tcp/80
const httpOptions = {
  createConnection: net.createConnection,
  libp2p,
  multiaddr: exampleMultiaddr,
  hops: [],
  proto: "/x/httpGoogle",
};

http.get("http://google.com", httpOptions, readResponse);
```

HTTPS

```js
const net = require("@network-stackify/libp2p-net");
const https = require("https"); //require('@network-stackify/https')
const tls = require("tls"); //require('@network-stackify/tls')

function readResponse(response) {
  var str = "";
  response.on("data", (chunk) => {
    str += chunk;
  });
  response.on("end", () => {
    console.log(str);
  });
}

const exampleMultiaddr = "/dns4/localhost/tcp/4003/ws/p2p/" + peerId;
const libp2p = await createLibp2pInstance(opts);

//go-ipfs: ipfs p2p listen /x/httpsGoogle /dns4/google.com/tcp/443
const httpsOptions = {
  createConnection: (opts) => {
    const socket = net.createConnection(opts);
    //Override net in tls module
    return tls.connect({ ...opts, ...tlsOptions, socket });
  },
  libp2p,
  multiaddr: exampleMultiaddr,
  hops: [],
  proto: "/x/httpsGoogle",

  //The following options are required but can be omitted when using an agent
  // results in EPERM (piping) or TLS errors if not strictly correct
  path: undefined,
  port: 443,
  servername: "google.com",
};

https.get("https://google.com", httpsOptions, readResponse);
```

### Browser

```js
module.export = {
  resolve: {
    fallback: {
      net: require.resolve("@network-stackify/libp2p-net"),

      //for https using net bundle
      tls: require.resolve("@network-stackify/tls"),
      https: require.resolve("@network-stackify/https"),

      //for http using libp2p-net
      http: require.resolve("@network-stackify/http"),
    },
  },
};
```

```js
const ws = require("ws");
const libp2p = createInstance();
let client = new ws("wss://endpoint.tld", {
  //Options for libp2p-net
  libp2p,
  multiaddr,
  proto,
  hops,
});
```

### Cross-platform

For easy front-end bundling, network-stackify uses native modules by default. This way, modules can be replaced selectively.

Other network-stackify modules like http, https, tls will require shimming the native net module or overriding defaults by passing opts.connect/createConnection or opts.socket.

## Contents

### Class: net.Socket

### net.connect()

### net.createConnection()

### net.isIP()

### net.isIPv4()

### net.isIPv6()

### net.\_normalizeArgs()
