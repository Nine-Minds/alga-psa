import 'dotenv/config';

import type { Server } from 'node:http';
import process from 'node:process';

import { closeDatabase, getDatabase } from './db/client.js';
import { createApp } from './http/app.js';

function readPort(): number {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

async function start(): Promise<void> {
  const database = getDatabase();
  await database.raw('select 1');

  const app = createApp();
  const port = readPort();
  const host = '0.0.0.0';

  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(port, host, () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });

  console.info(`AI gateway listening on ${host}:${port}`);

  const shutdown = async (signal: 'SIGINT' | 'SIGTERM'): Promise<void> => {
    console.info(`Received ${signal}; shutting down AI gateway`);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabase();
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT').then(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').then(() => process.exit(0));
  });
}

start().catch((error: unknown) => {
  console.error('Failed to start AI gateway', error);
  process.exit(1);
});
