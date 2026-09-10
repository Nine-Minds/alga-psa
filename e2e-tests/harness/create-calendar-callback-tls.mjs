import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createCalendarCallbackTls(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const config = join(directory, 'openssl.cnf');
  const cert = join(directory, 'certificate.pem');
  const key = join(directory, 'private-key.pem');
  writeFileSync(config, `[req]
distinguished_name=dn
x509_extensions=extensions
prompt=no
[dn]
CN=calendar-callback
[extensions]
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage=serverAuth
subjectAltName=@names
[names]
DNS.1=calendar-callback
DNS.2=localhost
IP.1=127.0.0.1
`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-keyout', key, '-out', cert, '-config', config], { stdio: 'pipe' });
  chmodSync(key, 0o600);
  chmodSync(cert, 0o644);
  return { key, cert };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Provide an owned temporary directory for callback TLS files');
  createCalendarCallbackTls(resolve(process.argv[2]));
}
