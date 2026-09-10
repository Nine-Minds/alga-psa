import net from 'node:net';

const port = Number(process.env.PORT || 6395);
const password = process.env.REDIS_PASSWORD || 'accounting-smoke';

function encode(value) {
  if (value === null) return '$-1\r\n';
  if (typeof value === 'number') return `:${value}\r\n`;
  if (Array.isArray(value)) return `*${value.length}\r\n${value.map(encode).join('')}`;
  const text = String(value);
  return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
}

function parse(buffer) {
  if (buffer[0] !== 42) return null;
  const firstEnd = buffer.indexOf('\r\n');
  if (firstEnd < 0) return null;
  const count = Number(buffer.subarray(1, firstEnd).toString());
  let offset = firstEnd + 2;
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer[offset] !== 36) return null;
    const lenEnd = buffer.indexOf('\r\n', offset);
    if (lenEnd < 0) return null;
    const len = Number(buffer.subarray(offset + 1, lenEnd).toString());
    const start = lenEnd + 2;
    const end = start + len;
    if (buffer.length < end + 2) return null;
    parts.push(buffer.subarray(start, end).toString());
    offset = end + 2;
  }
  return { parts, bytes: offset };
}

net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let authed = false;
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      const parsed = parse(buffer);
      if (!parsed) break;
      buffer = buffer.subarray(parsed.bytes);
      const [rawCommand, ...args] = parsed.parts;
      const command = rawCommand.toUpperCase();

      if (command === 'AUTH') {
        const supplied = args.length === 2 ? args[1] : args[0];
        authed = supplied === password;
        socket.write(authed ? '+OK\r\n' : '-WRONGPASS invalid username-password pair\r\n');
        continue;
      }
      if (!authed) {
        socket.write('-NOAUTH Authentication required.\r\n');
        continue;
      }

      if (command === 'PING') socket.write('+PONG\r\n');
      else if (command === 'QUIT') socket.end('+OK\r\n');
      else if (command === 'XGROUP') socket.write('+OK\r\n');
      else if (command === 'XREADGROUP') socket.write('*-1\r\n');
      else if (command === 'XAUTOCLAIM') socket.write(encode(['0-0', [], []]));
      else if (command === 'XPENDING') socket.write(args.length <= 2 ? encode([0, null, null, []]) : '*0\r\n');
      else if (command === 'ZRANGE' || command === 'ZRANGEBYSCORE' || command === 'MGET') socket.write('*0\r\n');
      else if (command === 'GET') socket.write('$-1\r\n');
      else if (command === 'XACK' || command === 'SISMEMBER' || command === 'SADD' || command === 'EXPIRE' || command === 'DEL' || command === 'ZREM') socket.write(':0\r\n');
      else if (command === 'SET') socket.write('+OK\r\n');
      else if (command === 'CLIENT' || command === 'SELECT') socket.write('+OK\r\n');
      else if (command === 'INFO') socket.write(encode('# Server\r\nredis_version:7.2.0\r\n'));
      else socket.write('+OK\r\n');
    }
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`Redis smoke simulator listening on 127.0.0.1:${port}`);
});
