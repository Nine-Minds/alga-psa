import net from 'node:net';
import { describe } from 'vitest';

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT || 5432);

/**
 * Probes the test database with a raw TCP connect (no credentials needed).
 */
export async function isDbReachable(
  host: string = DB_HOST,
  port: number = DB_PORT,
  timeoutMs = 500
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

/**
 * Returns `describe` when the database is reachable, `describe.skip` when it
 * is not — except in environments that declare REQUIRE_DB=1 (CI), where an
 * unreachable database is a hard failure instead of a silent skip. This is
 * what keeps DB-backed suites from passing vacuously in CI.
 *
 * Usage (top level of an integration test file):
 *   const describeDb = await describeWithDb();
 *   describeDb('my suite', () => { ... });
 */
export async function describeWithDb(): Promise<typeof describe | typeof describe.skip> {
  const reachable = await isDbReachable();
  if (reachable) {
    return describe;
  }
  if (process.env.REQUIRE_DB === '1') {
    throw new Error(
      `REQUIRE_DB=1 but the test database at ${DB_HOST}:${DB_PORT} is unreachable. ` +
        'Refusing to skip DB-backed tests in a required-DB environment.'
    );
  }
  return describe.skip;
}
