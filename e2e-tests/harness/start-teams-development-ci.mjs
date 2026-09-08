import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

// This entrypoint is only mounted by the development browser lane. It does not
// modify the production entrypoint or enable production Teams overrides.
if (process.env.NODE_ENV !== 'development' || process.env.TEAMS_EMULATOR_MODE !== 'true') {
  throw new Error('Teams development entrypoint requires explicit development configuration');
}
const env = { ...process.env };
for (const [key, filename] of [['NEXTAUTH_SECRET', 'nextauth_secret'], ['DB_PASSWORD_SERVER', 'db_password_server']]) {
  if (!env[key]) env[key] = readFileSync(`/run/secrets/${filename}`, 'utf8').trim();
  if (!env[key]) throw new Error(`Missing ${key} for isolated development app`);
}
env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER_SERVER || 'app_user')}:${encodeURIComponent(env.DB_PASSWORD_SERVER)}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME_SERVER}`;
// Avoid retaining Node source maps for this large development module graph.
// Browser traces remain available; server stack traces use generated locations.
const child = spawn(process.execPath, ['/app/node_modules/next/dist/bin/next', 'dev', '--webpack', '--disable-source-maps', '-p', '3000'], {
  cwd: '/app/server', env, stdio: 'inherit',
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Cannot start Teams development server'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
