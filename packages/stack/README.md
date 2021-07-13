# Description

This is a cross-platform networking stack built for the purpose of sending/recieving HTTP, HTTPS, TLS over arbitrary streams in both the browser and node. Works out of the box with [go-ipfs](https://github.com/ipfs/go-ipfs) and [js-libp2p](https://docs.libp2p.io/).

Inspired by [go-ipfs p2p streams](https://github.com/ipfs/go-ipfs/blob/master/docs/experimental-features.md#ipfs-p2p), [libp2p transports](https://docs.libp2p.io/concepts/transport) and [node.js](http://nodejs.org/) native modules.

> Most modules are ports of native modules to work with the browser. See [packages](#packages) for specifics.

Using these modules in your webapplication gives users autonomy to choose how they connect to an

# Table of Contents

- [Packages](#packages)
  - [net modules](#net-modules)
  - [http modules](#http-modules)
  - [transport modules](#transport-modules)
- [Installation](#installation)
  - [Node install](#node-install)
  - [Browser install](#browser-install)
- [Basic usage](#basic-usage)
  - [Node usage](#node-usage)
  - [Cross-platform usage](#cross-platform-usage)
  - [Browser usage](#browser-usage)
- [Client Examples](#client-examples)
  - [Basic examples](#basic-examples)
  - [Custom examples](#custom-examples)
    - [Custom https and tls](#custom-http-and-tls)
    - [Custom net](#custom-net)
    - [Cross-platform SSH](#cross-platform-ssh)

## Packages

### net modules

- [libp2p-net](https://github.com/SahidMiller/network-stackify/tree/master/packages/libp2p-net)

### http modules

- [http](https://github.com/SahidMiller/network-stackify/tree/master/packages/http)
- [https](https://github.com/SahidMiller/network-stackify/tree/master/packages/https)
- [tls](https://github.com/SahidMiller/network-stackify/tree/master/packages/tls)

### transport modules

- [ws](https://npmjs.com/packages/@network-stackify/ws)

## Installation

### Node Install

    npm install @network-stackify/stack

### Brower Install

Until ES6 is properly supported, use available [packages](#packages) for shimming:

    npm install @network-stackify/{package}

Otherwise, use node style with custom opts to override default native modules as explained in the cross-platform usage [section](#cross-platform-usage).

## Basic usage

All packages are cross-platform ready. For easy browser shimming and cross-platform usage the following strategies were taken:

1. All packages are drop-in replacements for native modules
2. All packages with dependencies use native modules by default.
3. Most modules are largely ports of native modules.
4. Only adds custom cross-platform implementations where they don't exist, preferring js-libp2p and node-forge and existing solutions.

### Node usage

Generally, passing custom sockets and connections to higher level native or network-stackify modules without shimming can be done using options like `opts.createConnection` or `opts.socket`.

See the available [net packages](#net-modules) for modules with a [net-like](https://nodejs.org/api/net.html) interface to create custom sockets and pass to higher level modules like [http modules](#http-modules) or [transport modules](#transport-modules) - or their native equivalent!

> See [transport modules](#transport-modules) for modified transports with options to pass custom sockets in nodejs (which isn't necessary when shimming)

### Cross platfrom usage

For packages available through npm, like websockets and ssh, options to pass custom sockets vary in name only or aren't available at all. Modifying code may be necessary for using these packages with network-stackify [packages](#packages) in node and/or browser applications.

> Be careful with combining shimming + passing custom connection options in cross-platform applications

### Browser usage

The main purpose of network-stackify is to enable using higher level npm packages (like websockets and ssh2) over libp2p in the browser.

The only modifications necessary to npm packages is removing any browser restrictions. Otherwise, when bundling, passing custom connections is possible without options like `opts.createConnection` or `opts.socket` through shimming or modification.

See [transport modules](#transport-modules) for packages with these browser restrictions already removed.

```js
const ws = require("@network-stackify/ws");
const createLibp2p = require("./createLibp2p");

const libp2p = createLibp2p();
const wsClient = new ws("wss://endpoint.tld", {
  libp2p,
  multiaddr,
  proto,
  hops,
});

wsClient.on("upgrade", connectedCb);
wsClient.on("message", messageCb);
```

```js
const ssh = require("ssh2");
const createLibp2p = require("./createLibp2p");

const libp2p = createLibp2p();
const sshClient = new ssh.Client();

sshClient.on("ready", readyCb);
sshClient.connect({ ...sshOptions, libp2p, multiaddr, proto, hops });
```

```js
//webpack.config.js
module.export = {
  //...
  resolve: {
    fallback: {
      //Shims net module in all packages
      net: require.resolve("@network-stackify/libp2p-net"),
      //Shims http module in https and ws and ssh
      http: require.resolve("@network-stackify/http"),
      //Shims tls module in https
      tls: require.resolve("@network-stackify/tls"),
      //Shims https module in ws
      https: require.resolve("@network-stackify/https"),

      //Remove for ssh2
      dns: false,
      child_process: false,
      "cpu-features": false,
    },
    alias: {
      //For ws
      url: require.resolve("./polyfills/url.js"),
      //For ssh2
      crypto: require.resolve("./polyfills/crypto.js"),
    },
  },
};
```

## Client Examples

```js
import { nets, http, https, tls } from "@network-stackify/stack";
const net = nets.libp2p;
import ws from "@network-stackify/ws";
```

### Basic examples

The following examples will demonstrate using stackify's custom http(s) and slightly modified [websocket transport](https://npmjs.com/packages/@network-stackify/ws) for cross-platform usage.

> Unmodified ws is usable in a browser or bundling context by using shimming as shown in the [node usage example](#browser-usage).

Each example _will use native or bundled net and tls modules_ - by not passing `opts.createConnection` to http(s). Each method also supports `http(s).Agent` syntax, slightly modified for passing custom connections - `new http(s).Agent({ createConnection })`

```js
export function googleHttp(readResponse) {
  http.request("http://google.com", readResponse).end();
}

export function googleHttps(readResponse) {
  https.request("https://google.com", readResponse).end();
}

export async function websocketHttp() {
  return await new ws("ws://example.tld", { get: http.get });
}

export async function websocketHttps() {
  return await new ws("wss://example.tld", { get: https.get });
}
```

### Custom examples

#### Custom HTTPS and TLS

The following examples will demonstrate using stackify's custom https and tls modules for cross-platform usage.

Each example _will bypass native or bundled tls module_ - by passing `opts.createConnection` to https but _will use native or bundled net module_ - by not passing `opts.socket` to tls.

```js
export function googleCustomHttps(readResponse) {
  const createConnection = (opts) => {
    //tls will use native or bundled net module
    return tls.connect({
      ...opts,

      //these options are required and can be omitted when using an agent
      // results in EPERM (piping) or TLS errors if not strictly correct
      path: null,
      port: 443,
      servername: "google.com",
      debug: true,
    });
  };

  https.request("https://google.com", { createConnection }, readResponse).end();
}

export async function websocketCustomHttps() {
  const createConnection = (opts) => {
    //tls will use native or bundled net module
    return tls.connect({
      ...opts,

      //these options are required and can be omitted when using an agent
      // results in EPERM (piping) or TLS errors if not strictly correct
      path: undefined,
      servername: opts.host,
    });
  };

  const client = await createSocket(
    new ws("wss://example.tld", { get: https.get, createConnection })
  );
}
```

#### Custom net

The following examples will demonstrate using stackify's custom net modules for cross-platform usage. Specifically, the libp2p-net net-like interface.

To follow along, run the following commands after enabling [go-ipfs p2p streams](https://github.com/ipfs/go-ipfs/blob/master/docs/experimental-features.md#ipfs-p2p)

> ipfs p2p listen /x/httpGoogle /dns4/google.com/tcp/80
> ipfs p2p listen /x/httpsGoogle /dns4/google.com/tcp/443
> ipfs p2p listen /x/httpCustom /dns4/example.tld/tcp/80
> ipfs p2p listen /x/httpsCustom /dns4/example.tld/tcp/443

Each example _will bypass native or bundled net and tls modules_ - by passing `opts.createConnection` and `opts.socket`.

Be careful not to mismatch between url, libp2p proto, and http(s) module, https catches these mismatches but http does not.

```js
//Browser requires: wss
const peerId = "";
const multiaddr = "/dns4/localhost/tcp/4003/ws/p2p/" + peerId;

export async function googleCustomLibp2pHttp(readResponse) {
  const libp2p = await createLibp2pInstance();
  const libp2pOpts = { libp2p, multiaddr, hops: [], proto: "/x/httpGoogle" };
  const opts = { createConnection: net.connect, ...libp2pOpts };
  http.request("http://google.com", opts, readResponse).end();
}

export async function googleCustomLibp2pHttps(readResponse) {
  const libp2p = await createLibp2pInstance();
  const libp2pOpts = { libp2p, multiaddr, hops: [], proto: "/x/httpsGoogle" };

  //these options are required and can be omitted when using an agent
  //  results in EPERM (piping) or TLS errors if not strictly correct
  const sslOpts = { path: undefined, port: 443, servername: "google.com" };

  const createConnection = (opts) => {
    const socket = net.connect(opts);
    return tls.connect({ ...opts, socket });
  };

  const opts = { createConnection, ...libp2pOpts, ...sslOpts };

  https.request("https://google.com", opts, readResponse).end();
}

export async function websocketCustomLibp2pHttp() {
  const libp2p = await createLibp2pInstance();
  const libp2pOpts = { libp2p, multiaddr, hops: [], proto: "/x/httpCustom" };
  const opts = {
    get: http.get,
    createConnection: net.createConnection,
    ...libp2pOpts,
  };

  return new ws("http://example.tld", opts);
}

export async function websocketCustomLibp2pHttps() {
  const libp2p = await createLibp2pInstance();
  const libp2pOpts = { libp2p, multiaddr, hops: [], proto: "/x/httpsCustom" };

  //these options are required and can be omitted when using an agent
  //  results in EPERM (piping) or TLS errors if not strictly correct
  const sslOpts = { path: undefined, port: 443, servername: "google.com" };

  const createConnection = (opts) => {
    const socket = net.createConnection(opts);
    return tls.connect({ ...opts, socket });
  };

  const opts = { get: https.get, createConnection, ...libp2pOpts, ...sslOpts };

  return new ws("https://example.tld", opts);
}
```

#### Cross-platform SSH

```js
const { Client } = require("ssh2");

export async function remoteSSH(sshOpts) {
  const libp2p = await createLibp2pInstance();
  const libp2pOpts = { libp2p, multiaddr, hops: [], proto: "/x/httpsGoogle" };
  const socket = net.createConnection(libp2pOpts);

  sshClient.on("ready", onReady).connect({ ...sshOpts, sock: socket });
  return sshClient;
}
```

```js
//Overrides for browser
module.exports = {
  //...
  resolve: {
    fallback: {
      dns: false,
      child_process: false,
      "cpu-features": false,
    },
  },
  alias: {
    crypto: require.resolve("./polyfills/crypto.js"),
  },
};
```

```js
//polyfills/crypto.js
const crypto = require("crypto-browserify");

const createSign = crypto.createSign;
crypto.createSign = ((algo) => {
  algo = algo === "sha1" ? "RSA-SHA1" : algo;
  return createSign(algo);
}).bind(crypto);

module.exports = crypto;
```
