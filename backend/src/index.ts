
import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { attachRealtime } from './realtime/socket.js';

const config = loadConfig();

const { app, service } = createApp(config);
const httpServer = createServer(app);

const io = new Server(
  httpServer,
  config.corsOrigin === false
    ? {}
    : {
        cors: {
          origin: config.corsOrigin,
          methods: ['GET', 'POST'],
        },
      },
);

attachRealtime(io, service);

httpServer.listen(config.port, config.host, () => {
  console.log(`GameZone: http://localhost:${config.port}`);
  console.log(`API Health: http://localhost:${config.port}/api/health`);
});

httpServer.on('error', (error) => {
  console.error('Server error:', error);
  process.exitCode = 1;
});

function shutdown() {
  console.log('Shutting down GameZone...');
  io.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
