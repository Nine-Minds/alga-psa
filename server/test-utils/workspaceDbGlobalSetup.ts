import { createTestDbConnection } from './dbConfig';

// Some colocated suites bootstrap their own schema; the hour-block suites
// intentionally consume an already migrated database. Prepare that schema
// once before file ordering can put one of those suites first.
export default async function setupWorkspaceDatabase() {
  const db = await createTestDbConnection();
  await db.destroy();
}
