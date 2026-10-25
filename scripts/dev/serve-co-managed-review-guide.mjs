#!/usr/bin/env node
// Serve the card's review packet with byte ranges so recorded chapters can seek.
import express from 'express';
import { realpathSync, statSync } from 'node:fs';

const rootArgument = process.argv[2];
if (!rootArgument) throw new Error('Supply the absolute review packet directory.');
const root = realpathSync(rootArgument);
if (!statSync(root).isDirectory()) throw new Error('Review packet root must be a directory.');
const port = Number(process.env.PORT ?? 8874);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');

const app = express();
app.disable('x-powered-by');
app.use(express.static(root, {
  dotfiles: 'deny',
  fallthrough: false,
  etag: false,
  setHeaders: response => response.setHeader('Cache-Control', 'no-cache'),
}));
app.listen(port, '0.0.0.0', () => console.log(`Review packet serving on :${port}; byte ranges enabled.`));
