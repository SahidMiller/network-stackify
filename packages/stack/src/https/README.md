# `@network-stackify/https`

> Drop in replacement for https module

## Usage

In nodejs, use like the native https module:

```js
const https = require("@network-stackify/https");

function readResponse(response) {
  var str = "";
  response.on("data", (chunk) => {
    str += chunk;
  });
  response.on("end", () => {
    console.log(str);
  });
}

//Defaults to using native net and tls modules.
https.request("https://google.com", readResponse).end();
https.get("https://google.com", readResponse).end();

//Customize net and/or tls module by passing opts.createConnection
const createConnection = (opts) => {
  return socket;
};

const options = {
  //these options are required and can be omitted when using an agent
  // results in EPERM (piping) or TLS errors if not strictly correct
  path: null,
  port: 443,
  servername: "google.com",
  createConnection,
};

https.get("https://google.com", options, readResponse).end();

//Agent syntax supports slightly modified syntax for passing custom createConnection
https.get("https://google.com", {
  agent: new https.Agent({ createConnection }),
});
```

### Browser

Browser will require custom net and tls implementation like [@network-stackify/libp2p-net](https://github.com/sahidmiller/network-stackify/tree/master/packages/libp2p-net) and [@network-stackify/tls](https://github.com/sahidmiller/network-stackify/tree/master/packages/tls).

```js
module.export = {
  resolve: {
    fallback: {
      https: require.resolve("@network-stackify/https"),
      tls: require.resolve("@network-stackify/tls"),
      net: require.resolve("@network-stackify/libp2p-net"),
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

But if using a custom net and tls module for both browser and nodejs, a non-bundling solution is necessary. Overriding defaults can be done by passing opts.connect/createConnection or opts.socket.

```js
//ws implementation with opts.get and opts.createConnection
const ws = require("@network-stackify/ws");

const https = require("@network-stackify/https");
const tls = require("@network-stackify/tls");
const net = require("@network-stackify/libp2p-net");

const libp2p = createInstance(opts);

const createConnection = (opts) => {
  const socket = net.connect(opts);
  return tls.connect({ ...opts, socket });
};

const options = {
  //Override native https.get (in ws)
  get: https.get,

  //Override native tls.connect
  createConnection,

  //these options are required and can be omitted when using an agent
  // results in EPERM (piping) or TLS errors if not strictly correct
  path: null,
  port: 443,
  servername: "google.com",

  //Custom net options
  libp2p,
  multiaddrs,
  hops,
  proto,
};
```

## Contents

### Class: https.Agent

### https.get(options[, callback])

### https.get(url[, options][, callback])

### https.globalAgent

### https.request(options[, callback])

### https.request(url[, options][, callback])
