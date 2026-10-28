// Plain TCP forwarder: lets a smoke test cut one process off from a shared
// dependency (kill this proxy) without stopping the dependency for everyone.
import net from 'node:net';
const [listenPort, targetHost, targetPort] = process.argv.slice(2);
const sockets = new Set();
net.createServer((client) => {
  const upstream = net.connect(Number(targetPort), targetHost);
  for (const s of [client, upstream]) { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => s.destroy()); }
  client.pipe(upstream); upstream.pipe(client);
}).listen(Number(listenPort), '127.0.0.1', () => console.log(`proxy 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}`));
