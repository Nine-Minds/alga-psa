#!/usr/bin/env tsx
import { createServer as createHttpsServer } from 'https';
import { parse } from 'url';
import next from 'next';
import fs from 'fs';

const dev = process.env.NODE_ENV !== 'production';

// Parse hostname and port from NEXTAUTH_URL if available, otherwise use fallbacks
let hostname = 'localhost';
let port = 3000;

if (process.env.NEXTAUTH_URL) {
  try {
    const nextAuthUrl = new URL(process.env.NEXTAUTH_URL);
    hostname = nextAuthUrl.hostname;
    port = nextAuthUrl.port ? parseInt(nextAuthUrl.port, 10) : 3000;
  } catch (err) {
    console.warn('Failed to parse NEXTAUTH_URL, using fallback hostname and port');
  }
}

// SSL Configuration
const sslCertPath = process.env.SSL_CERT_PATH || '/etc/ssl/my_certs/server.crt';
const sslKeyPath = process.env.SSL_KEY_PATH || '/etc/ssl/my_certs/server.key';

console.log('Initializing Next.js HTTPS wrapper...');
console.log(`Environment: ${dev ? 'development' : 'production'}`);
console.log(`Reading SSL certificates from:`);
console.log(`  Key:  ${sslKeyPath}`);
console.log(`  Cert: ${sslCertPath}`);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const requestHandler = async (req: any, res: any) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  };

  try {
    const httpsOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };

    const server = createHttpsServer(httpsOptions, requestHandler);

    server.listen(port, '0.0.0.0', () => {
      console.log('');
      console.log(`HTTPS Server ready`);
      console.log(`  URL: https://${hostname}:${port}`);
      console.log(`  Mode: ${dev ? 'development' : 'production'}`);
      console.log('');
    });

    server.on('error', (err) => {
      console.error('HTTPS server error:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('Failed to start HTTPS server:', err);
    console.error('Please check that SSL certificates exist and are readable');
    process.exit(1);
  }
}).catch((err) => {
  console.error('Failed to prepare Next.js:', err);
  process.exit(1);
});
