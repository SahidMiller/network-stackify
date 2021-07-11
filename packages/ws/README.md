# `@network-stackify/ws`

> Fork of [ws](https://github.com/websockets/ws) package with opts.get and opts.createConnection

## Usage

This is only required when shimming isn't a complete solution, for example, non-browser environments.

```js
const https = require("@network-stackify/https");
const tls = require("@network-stackify/tls");
const net = require("@network-stackify/libp2p-net");

const ws = require("@network-stackify/ws");

const libp2p = createInstance(opts);
new ws("wss://endpoint.tld", {
  //Override native https.get (in ws)
  get: https.get,

  //Override native tls.connect
  createConnection: (opts) => {
    const socket = net.createConnection(opts);
    return tls.connect({ ...opts, socket });
  },

  //Options for net and tls
  libp2p,
  multiaddrs,
  hops,
  proto,
});
```
