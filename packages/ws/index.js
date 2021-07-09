'use strict';

const WebSocket = require('./src/websocket');

WebSocket.createWebSocketStream = require('./src/stream');
WebSocket.Server = require('./src/websocket-server');
WebSocket.Receiver = require('./src/receiver');
WebSocket.Sender = require('./src/sender');

module.exports = WebSocket;
