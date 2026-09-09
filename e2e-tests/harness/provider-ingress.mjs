import net from 'node:net';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createCalendarCallbackServer } from './calendar-callback-proxy.mjs';

// Publish only fixed test-stack destinations. Alga, workers and algasim stay
// on the internal network; this process cannot act as an arbitrary HTTP proxy.
const destinations = [
  [3000, 'server', 3000],
  [5432, 'postgres', 5432],
  [55433, 'upgrade-citus', 5432],
  [3025, 'imap-test-server', 3025],
  [6379, 'redis', 6379],
  ...[4010, 4020, 4030, 4040, 4050, 4060, 9500].map(port => [port, 'algasim', port]),
];

export function createProviderIngressServer(port, { connect = options => net.connect(options) } = {}) {
  const destination = destinations.find(([listenPort]) => listenPort === port);
  if (!destination) throw new Error('Unknown test ingress port');
  const [, host, targetPort] = destination;
  return net.createServer(client => {
    const upstream = connect({ host, port: targetPort });
    const close = () => { client.destroy(); upstream.destroy(); };
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.E2E_CALENDAR_CALLBACK_TLS === 'true') {
    createCalendarCallbackServer({
      key: readFileSync('/calendar-tls/private-key.pem'),
      cert: readFileSync('/calendar-tls/certificate.pem'),
    }).on('error', error => {
      console.error(`Cannot bind calendar callback: ${error.code}`);
      process.exit(1);
    }).listen(3443, '0.0.0.0');
  }
  for (const [port] of destinations) {
    createProviderIngressServer(port).on('error', error => {
      console.error(`Cannot bind test ingress ${port}: ${error.code}`);
      process.exit(1);
    }).listen(port, '0.0.0.0');
  }
}
