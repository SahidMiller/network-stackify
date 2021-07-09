/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^ws$" }] */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const path = require('path');
const net = require('net');
const fs = require('fs');
const os = require('os');

const Sender = require('../lib/sender');
const WebSocket = require('..');
const { NOOP } = require('../lib/constants');

describe('WebSocketServer', () => {
  describe('#ctor', () => {
    it('throws an error if no option object is passed', () => {
      assert.throws(() => new WebSocket.Server());
    });

    describe('options', () => {
      it('throws an error if no `port` or `server` option is specified', () => {
        assert.throws(() => new WebSocket.Server({}));
      });

      it('exposes options passed to constructor', (done) => {
        const wss = new WebSocket.Server({ port: 0 }, () => {
          assert.strictEqual(wss.options.port, 0);
          wss.close(done);
        });
      });

      it('accepts the `maxPayload` option', (done) => {
        const maxPayload = 20480;
        const wss = new WebSocket.Server(
          {
            perMessageDeflate: true,
            maxPayload,
            port: 0
          },
          () => {
            const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
          }
        );

        wss.on('connection', (ws) => {
          assert.strictEqual(ws._receiver._maxPayload, maxPayload);
          assert.strictEqual(
            ws._receiver._extensions['permessage-deflate']._maxPayload,
            maxPayload
          );
          wss.close(done);
        });
      });
    });

    it('emits an error if http server bind fails', (done) => {
      const wss1 = new WebSocket.Server({ port: 0 }, () => {
        const wss2 = new WebSocket.Server({
          port: wss1.address().port
        });

        wss2.on('error', () => wss1.close(done));
      });
    });

    it('starts a server on a given port', (done) => {
      const port = 1337;
      const wss = new WebSocket.Server({ port }, () => {
        const ws = new WebSocket(`ws://localhost:${port}`);
      });

      wss.on('connection', () => wss.close(done));
    });

    it('binds the server on any IPv6 address when available', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        assert.strictEqual(wss._server.address().address, '::');
        wss.close(done);
      });
    });

    it('uses a precreated http server', (done) => {
      const server = http.createServer();

      server.listen(0, () => {
        const wss = new WebSocket.Server({ server });
        const ws = new WebSocket(`ws://localhost:${server.address().port}`);

        wss.on('connection', () => {
          wss.close();
          server.close(done);
        });
      });
    });

    it('426s for non-Upgrade requests', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        http.get(`http://localhost:${wss.address().port}`, (res) => {
          let body = '';

          assert.strictEqual(res.statusCode, 426);
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            assert.strictEqual(body, http.STATUS_CODES[426]);
            wss.close(done);
          });
        });
      });
    });

    it('uses a precreated http server listening on unix socket', function (done) {
      //
      // Skip this test on Windows. The URL parser:
      //
      // - Throws an error if the named pipe uses backward slashes.
      // - Incorrectly parses the path if the named pipe uses forward slashes.
      //
      if (process.platform === 'win32') return this.skip();

      const server = http.createServer();
      const sockPath = path.join(
        os.tmpdir(),
        `ws.${crypto.randomBytes(16).toString('hex')}.sock`
      );

      server.listen(sockPath, () => {
        const wss = new WebSocket.Server({ server });

        wss.on('connection', (ws, req) => {
          if (wss.clients.size === 1) {
            assert.strictEqual(req.url, '/foo?bar=bar');
          } else {
            assert.strictEqual(req.url, '/');
            wss.close();
            server.close(done);
          }
        });

        const ws = new WebSocket(`ws+unix://${sockPath}:/foo?bar=bar`);
        ws.on('open', () => new WebSocket(`ws+unix://${sockPath}`));
      });
    });
  });

  describe('#address', () => {
    it('returns the address of the server', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const addr = wss.address();

        assert.deepStrictEqual(addr, wss._server.address());
        wss.close(done);
      });
    });

    it('throws an error when operating in "noServer" mode', () => {
      const wss = new WebSocket.Server({ noServer: true });

      assert.throws(() => {
        wss.address();
      }, /^Error: The server is operating in "noServer" mode$/);
    });

    it('returns `null` if called after close', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        wss.close(() => {
          assert.strictEqual(wss.address(), null);
          done();
        });
      });
    });
  });

  describe('#close', () => {
    it('does not throw when called twice', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        wss.close();
        wss.close();
        wss.close();

        done();
      });
    });

    it('closes all clients', (done) => {
      let closes = 0;
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        ws.on('close', () => {
          if (++closes === 2) done();
        });
      });

      wss.on('connection', (ws) => {
        ws.on('close', () => {
          if (++closes === 2) done();
        });
        wss.close();
      });
    });

    it("doesn't close a precreated server", (done) => {
      const server = http.createServer();
      const realClose = server.close;

      server.close = () => {
        done(new Error('Must not close pre-created server'));
      };

      const wss = new WebSocket.Server({ server });

      wss.on('connection', () => {
        wss.close();
        server.close = realClose;
        server.close(done);
      });

      server.listen(0, () => {
        const ws = new WebSocket(`ws://localhost:${server.address().port}`);
      });
    });

    it('invokes the callback in noServer mode', (done) => {
      const wss = new WebSocket.Server({ noServer: true });

      wss.close(done);
    });

    it('cleans event handlers on precreated server', (done) => {
      const server = http.createServer();
      const wss = new WebSocket.Server({ server });

      server.listen(0, () => {
        wss.close(() => {
          assert.strictEqual(server.listenerCount('listening'), 0);
          assert.strictEqual(server.listenerCount('upgrade'), 0);
          assert.strictEqual(server.listenerCount('error'), 0);

          server.close(done);
        });
      });
    });

    it("emits the 'close' event", (done) => {
      const wss = new WebSocket.Server({ noServer: true });

      wss.on('close', done);
      wss.close();
    });
  });

  describe('#clients', () => {
    it('returns a list of connected clients', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        assert.strictEqual(wss.clients.size, 0);
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
      });

      wss.on('connection', () => {
        assert.strictEqual(wss.clients.size, 1);
        wss.close(done);
      });
    });

    it('can be disabled', (done) => {
      const wss = new WebSocket.Server(
        { port: 0, clientTracking: false },
        () => {
          assert.strictEqual(wss.clients, undefined);
          const ws = new WebSocket(`ws://localhost:${wss.address().port}`);

          ws.on('open', () => ws.close());
        }
      );

      wss.on('connection', (ws) => {
        assert.strictEqual(wss.clients, undefined);
        ws.on('close', () => wss.close(done));
      });
    });

    it('is updated when client terminates the connection', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);

        ws.on('open', () => ws.terminate());
      });

      wss.on('connection', (ws) => {
        ws.on('close', () => {
          assert.strictEqual(wss.clients.size, 0);
          wss.close(done);
        });
      });
    });

    it('is updated when client closes the connection', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);

        ws.on('open', () => ws.close());
      });

      wss.on('connection', (ws) => {
        ws.on('close', () => {
          assert.strictEqual(wss.clients.size, 0);
          wss.close(done);
        });
      });
    });
  });

  describe('#shouldHandle', () => {
    it('returns true when the path matches', () => {
      const wss = new WebSocket.Server({ noServer: true, path: '/foo' });

      assert.strictEqual(wss.shouldHandle({ url: '/foo' }), true);
      assert.strictEqual(wss.shouldHandle({ url: '/foo?bar=baz' }), true);
    });

    it("returns false when the path doesn't match", () => {
      const wss = new WebSocket.Server({ noServer: true, path: '/foo' });

      assert.strictEqual(wss.shouldHandle({ url: '/bar' }), false);
    });
  });

  describe('#handleUpgrade', () => {
    it('can be used for a pre-existing server', (done) => {
      const server = http.createServer();

      server.listen(0, () => {
        const wss = new WebSocket.Server({ noServer: true });

        server.on('upgrade', (req, socket, head) => {
          wss.handleUpgrade(req, socket, head, (client) =>
            client.send('hello')
          );
        });

        const ws = new WebSocket(`ws://localhost:${server.address().port}`);

        ws.on('message', (message) => {
          assert.strictEqual(message, 'hello');
          wss.close();
          server.close(done);
        });
      });
    });

    it("closes the connection when path doesn't match", (done) => {
      const wss = new WebSocket.Server({ port: 0, path: '/ws' }, () => {
        const req = http.get({
          port: wss.address().port,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket'
          }
        });

        req.on('response', (res) => {
          assert.strictEqual(res.statusCode, 400);
          wss.close(done);
        });
      });
    });

    it('closes the connection when protocol version is Hixie-76', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const req = http.get({
          port: wss.address().port,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'WebSocket',
            'Sec-WebSocket-Key1': '4 @1  46546xW%0l 1 5',
            'Sec-WebSocket-Key2': '12998 5 Y3 1  .P00',
            'Sec-WebSocket-Protocol': 'sample'
          }
        });

        req.on('response', (res) => {
          assert.strictEqual(res.statusCode, 400);
          wss.close(done);
        });
      });
    });
  });

  describe('#completeUpgrade', () => {
    it('throws an error if called twice with the same socket', (done) => {
      const server = http.createServer();

      server.listen(0, () => {
        const wss = new WebSocket.Server({ noServer: true });

        server.on('upgrade', (req, socket, head) => {
          wss.handleUpgrade(req, socket, head, (ws) => {
            ws.close();
          });
          assert.throws(
            () => wss.handleUpgrade(req, socket, head, NOOP),
            (err) => {
              assert.ok(err instanceof Error);
              assert.strictEqual(
                err.message,
                'server.handleUpgrade() was called more than once with the ' +
                  'same socket, possibly due to a misconfiguration'
              );
              return true;
            }
          );
        });

        const ws = new WebSocket(`ws://localhost:${server.address().port}`);

        ws.on('open', () => {
          ws.on('close', () => {
            server.close(done);
          });
        });
      });
    });
  });

  describe('Connection establishing', () => {
    it('fails if the Sec-WebSocket-Key header is invalid (1/2)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const req = http.get({
          port: wss.address().port,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket'
          }
        });

        req.on('response', (res) => {
          assert.strictEqual(res.statusCode, 400);
          wss.close(done);
        });
      });

      wss.on('connection', () => {
        done(new Error("Unexpected 'connection' event"));
      });
    });

    it('fails if the Sec-WebSocket-Key header is invalid (2/2)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const req = http.get({
          port: wss.address().port,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': 'P5l8BJcZwRc='
          }
        });

        req.on('response', (res) => {
          assert.strictEqual(res.statusCode, 400);
          wss.close(done);
        });
      });

      wss.on('connection', () => {
        done(new Error("Unexpected 'connection' event"));
      });
    });

    it('fails if the Sec-WebSocket-Version header is invalid (1/2)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const req = http.get({
          port: wss.address().port,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='
          }
        });

        req.on('response', (res) => {
          assert.strictEqual(res.statusCode, 400);
          wss.close(done);
        });
      });

      wss.on('connection', () => {
        done(new Error("Unexpected 'connection' event"));
      });
    });

    it('fails if the Sec-WebSocket-Version header is invalid (2/2)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const req = http.get({
          port: wss.address().port,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': 12
          }
        });

        req.on('response', (res) => {
          assert.strictEqual(res.statusCode, 400);
          wss.close(done);
        });
      });

      wss.on('connection', () => {
        done(new Error("Unexpected 'connection' event"));
      });
    });

    it('fails if the Sec-WebSocket-Extensions header is invalid', (done) => {
      const wss = new WebSocket.Server(
        {
          perMessageDeflate: true,
          port: 0
        },
        () => {
          const req = http.get({
            port: wss.address().port,
            headers: {
              Connection: 'Upgrade',
              Upgrade: 'websocket',
              'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
              'Sec-WebSocket-Version': 13,
              'Sec-WebSocket-Extensions':
                'permessage-deflate; server_max_window_bits=foo'
            }
          });

          req.on('response', (res) => {
            assert.strictEqual(res.statusCode, 400);
            wss.close(done);
          });
        }
      );

      wss.on('connection', () => {
        done(new Error("Unexpected 'connection' event"));
      });
    });

    it('handles unsupported extensions', (done) => {
      const wss = new WebSocket.Server(
        {
          perMessageDeflate: true,
          port: 0
        },
        () => {
          const req = http.get({
            port: wss.address().port,
            headers: {
              Connection: 'Upgrade',
              Upgrade: 'websocket',
              'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
              'Sec-WebSocket-Version': 13,
              'Sec-WebSocket-Extensions': 'foo; bar'
            }
          });

          req.on('upgrade', (res, socket, head) => {
            if (head.length) socket.unshift(head);

            socket.once('data', (chunk) => {
              assert.strictEqual(chunk[0], 0x88);
              wss.close(done);
            });
          });
        }
      );

      wss.on('connection', (ws) => {
        assert.strictEqual(ws.extensions, '');
        ws.close();
      });
    });

    describe('`verifyClient`', () => {
      it('can reject client synchronously', (done) => {
        const wss = new WebSocket.Server(
          {
            verifyClient: () => false,
            port: 0
          },
          () => {
            const req = http.get({
              port: wss.address().port,
              headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version': 8
              }
            });

            req.on('response', (res) => {
              assert.strictEqual(res.statusCode, 401);
              wss.close(done);
            });
          }
        );

        wss.on('connection', () => {
          done(new Error("Unexpected 'connection' event"));
        });
      });

      it('can accept client synchronously', (done) => {
        const server = https.createServer({
          cert: fs.readFileSync('test/fixtures/certificate.pem'),
          key: fs.readFileSync('test/fixtures/key.pem')
        });

        const wss = new WebSocket.Server({
          verifyClient: (info) => {
            assert.strictEqual(info.origin, 'https://example.com');
            assert.strictEqual(info.req.headers.foo, 'bar');
            assert.ok(info.secure, true);
            return true;
          },
          server
        });

        wss.on('connection', () => {
          wss.close();
          server.close(done);
        });

        server.listen(0, () => {
          const ws = new WebSocket(`wss://localhost:${server.address().port}`, {
            headers: { Origin: 'https://example.com', foo: 'bar' },
            rejectUnauthorized: false
          });
        });
      });

      it('can accept client asynchronously', (done) => {
        const wss = new WebSocket.Server(
          {
            verifyClient: (o, cb) => process.nextTick(cb, true),
            port: 0
          },
          () => {
            const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
          }
        );

        wss.on('connection', () => wss.close(done));
      });

      it('can reject client asynchronously', (done) => {
        const wss = new WebSocket.Server(
          {
            verifyClient: (info, cb) => process.nextTick(cb, false),
            port: 0
          },
          () => {
            const req = http.get({
              port: wss.address().port,
              headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version': 8
              }
            });

            req.on('response', (res) => {
              assert.strictEqual(res.statusCode, 401);
              wss.close(done);
            });
          }
        );

        wss.on('connection', () => {
          done(new Error("Unexpected 'connection' event"));
        });
      });

      it('can reject client asynchronously w/ status code', (done) => {
        const wss = new WebSocket.Server(
          {
            verifyClient: (info, cb) => process.nextTick(cb, false, 404),
            port: 0
          },
          () => {
            const req = http.get({
              port: wss.address().port,
              headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version': 8
              }
            });

            req.on('response', (res) => {
              assert.strictEqual(res.statusCode, 404);
              wss.close(done);
            });
          }
        );

        wss.on('connection', () => {
          done(new Error("Unexpected 'connection' event"));
        });
      });

      it('can reject client asynchronously w/ custom headers', (done) => {
        const wss = new WebSocket.Server(
          {
            verifyClient: (info, cb) => {
              process.nextTick(cb, false, 503, '', { 'Retry-After': 120 });
            },
            port: 0
          },
          () => {
            const req = http.get({
              port: wss.address().port,
              headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version': 8
              }
            });

            req.on('response', (res) => {
              assert.strictEqual(res.statusCode, 503);
              assert.strictEqual(res.headers['retry-after'], '120');
              wss.close(done);
            });
          }
        );

        wss.on('connection', () => {
          done(new Error("Unexpected 'connection' event"));
        });
      });
    });

    it("doesn't emit the 'connection' event if socket is closed prematurely", (done) => {
      const server = http.createServer();

      server.listen(0, () => {
        const wss = new WebSocket.Server({
          verifyClient: ({ req: { socket } }, cb) => {
            assert.strictEqual(socket.readable, true);
            assert.strictEqual(socket.writable, true);

            socket.on('end', () => {
              assert.strictEqual(socket.readable, false);
              assert.strictEqual(socket.writable, true);
              cb(true);
            });
          },
          server
        });

        wss.on('connection', () => {
          done(new Error("Unexpected 'connection' event"));
        });

        const socket = net.connect(
          {
            port: server.address().port,
            allowHalfOpen: true
          },
          () => {
            socket.end(
              [
                'GET / HTTP/1.1',
                'Host: localhost',
                'Upgrade: websocket',
                'Connection: Upgrade',
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version: 13',
                '\r\n'
              ].join('\r\n')
            );
          }
        );

        socket.on('end', () => {
          wss.close();
          server.close(done);
        });
      });
    });

    it('handles data passed along with the upgrade request', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const req = http.request({
          port: wss.address().port,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': 13
          }
        });

        const list = Sender.frame(Buffer.from('Hello'), {
          fin: true,
          rsv1: false,
          opcode: 0x01,
          mask: true,
          readOnly: false
        });

        req.write(Buffer.concat(list));
        req.end();
      });

      wss.on('connection', (ws) => {
        ws.on('message', (data) => {
          assert.strictEqual(data, 'Hello');
          wss.close(done);
        });
      });
    });

    describe('`handleProtocols`', () => {
      it('allows to select a subprotocol', (done) => {
        const handleProtocols = (protocols, request) => {
          assert.ok(request instanceof http.IncomingMessage);
          assert.strictEqual(request.url, '/');
          return protocols.pop();
        };
        const wss = new WebSocket.Server({ handleProtocols, port: 0 }, () => {
          const ws = new WebSocket(`ws://localhost:${wss.address().port}`, [
            'foo',
            'bar'
          ]);

          ws.on('open', () => {
            assert.strictEqual(ws.protocol, 'bar');
            wss.close(done);
          });
        });
      });
    });

    it("emits the 'headers' event", (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);

        wss.on('headers', (headers, request) => {
          assert.deepStrictEqual(headers.slice(0, 3), [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade'
          ]);
          assert.ok(request instanceof http.IncomingMessage);
          assert.strictEqual(request.url, '/');

          wss.on('connection', () => wss.close(done));
        });
      });
    });
  });

  describe('permessage-deflate', () => {
    it('is disabled by default', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
      });

      wss.on('connection', (ws, req) => {
        assert.strictEqual(
          req.headers['sec-websocket-extensions'],
          'permessage-deflate; client_max_window_bits'
        );
        assert.strictEqual(ws.extensions, '');
        wss.close(done);
      });
    });

    it('uses configuration options', (done) => {
      const wss = new WebSocket.Server(
        {
          perMessageDeflate: { clientMaxWindowBits: 8 },
          port: 0
        },
        () => {
          const ws = new WebSocket(`ws://localhost:${wss.address().port}`);

          ws.on('upgrade', (res) => {
            assert.strictEqual(
              res.headers['sec-websocket-extensions'],
              'permessage-deflate; client_max_window_bits=8'
            );

            wss.close(done);
          });
        }
      );
    });
  });
});
