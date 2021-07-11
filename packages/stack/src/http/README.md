# `@network-stackify/http`

> Drop in replacement for http module

## Usage

In nodejs, use like the native http module:

```js
const http = require("@network-stackify/http");
function readResponse(response) {
  var str = "";
  response.on("data", (chunk) => {
    str += chunk;
  });
  response.on("end", () => {
    console.log(str);
  });
}

//Defaults to using native net module.
http.request("http://google.com", readResponse).end();
http.get("http://google.com", readResponse).end();

//Customize net module by passing opts.createConnection
const createConnection = (opts) => {
  return socket;
};

http.get("http://google.com", { createConnection }, readResponse).end();

//Agent syntax supports slightly modified syntax for passing custom createConnection
http.get("http://google.com", {
  agent: new http.Agent({ createConnection }),
});
```

### Browser

Browser will require custom net implementation like [libp2p-net](https://github.com/sahidmiller/network-stackify/tree/master/packages/libp2p-net)

```js
module.export = {
  resolve: {
    fallback: {
      http: require.resolve("@network-stackify/http"),
      net: require.resolve("@network-stackify/libp2p-net"),
    },
  },
};
```

```js
const ws = require("ws");
const libp2p = createInstance();
let client = new ws("ws://endpoint.tld", {
  //Options for libp2p-net
  libp2p,
  multiaddr,
  proto,
  hops,
});
```

### Cross-platform

For easy front-end bundling, network-stackify uses native modules by default. This way, modules can be replaced selectively.

But if using a custom net module for both browser and nodejs, a non-bundling solution is necessary. Overriding defaults can be done by passing opts.connect/createConnection.

```js
//ws implementation with opts.get and opts.createConnection
const ws = require('@network-stackify/ws');
const http = require('@network-stackify/http');
const net = require('@network-stackify/libp2p-net');

const libp2p = createInstance(opts);
new ws("ws://endpoint.tld", {
  //Override native http.get (in ws)
  get: http.get,

  //Override native net.createConnection
  createConnection: net.createConnection

  //Custom net options
  libp2p,
  multiaddrs,
  hops,
  proto
})
```

## Contents

### Class: http.Agent

### Class: http.ClientRequest

### Class: http.IncomingMessage

### http.get(options[, callback])

### http.get(url[, options][, callback])

### http.request(options[, callback])

### http.request(url[, options][, callback])

### http.METHODS

### http.STATUS_CODES

### http.globalAgent
