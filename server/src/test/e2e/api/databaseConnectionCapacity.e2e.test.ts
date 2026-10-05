import { describe, expect, it } from 'vitest';
import { Client } from 'pg';

import { applicationTestDatabaseConfig, connectApplicationTestDatabase } from '../utils/applicationTestDatabase';

describe('Fresh-install database connection capacity', () => {
  it('keeps direct API fixture connections available alongside enterprise services', async () => {
    const owner = await connectApplicationTestDatabase();
    const clients: Client[] = [];
    try {
      // Holding more sessions than PostgreSQL's default limit reproduces the
      // exhaustion that previously skipped the later API E2E suites.
      const simultaneousConnections = process.env.E2E_EDITION === 'enterprise' ? 101 : 1;
      const connection = applicationTestDatabaseConfig().connection as {
        host: string; port: number; database: string; user: string; password: string;
      };
      for (let index = 0; index < simultaneousConnections; index++) {
        const client = new Client({ ...connection, connectionTimeoutMillis: 3000 });
        clients.push(client);
        await client.connect();
      }
      const results = await Promise.all(clients.map((client) => client.query('SELECT 1 AS ready')));
      expect(results).toHaveLength(simultaneousConnections);
      expect(results.every((result) => result.rows[0]?.ready === 1)).toBe(true);
    } finally {
      await Promise.allSettled(clients.map((client) => client.end()));
      await owner.destroy();
    }
  }, 60_000);
});
