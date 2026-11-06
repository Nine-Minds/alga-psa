#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { package: { type: 'string' }, tenant: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  process.stdout.write('Import AMP into a fresh tenant (installation database owner only). Repeat the same package and tenant to resume.\n--package <workspace.amp> --tenant <new UUID> --name <workspace name> --email <owner email>\nUsers remain inactive, workflows paused, calendars cancelled, and connections require reauthorization.\n');
} else {
  if (!values.package || !values.tenant || !values.name || !values.email) throw new Error('Package, fresh tenant UUID, name and email required');
  const { forcedValue } = await import('@alga-psa/core/capability');
  const forced = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  if (forced === 'off' || forced === 'malformed') throw new Error('Co-managed capability disabled');
  const { getAdminConnection } = await import('@alga-psa/db/admin');
  const { AmpWorkspaceImportService } = await import('../src/lib/migrations/AmpWorkspaceImportService');
  const db = await getAdminConnection();
  try {
    const result = await new AmpWorkspaceImportService(db).importPackage({ packagePath: resolve(values.package), targetTenant: values.tenant, name: values.name, email: values.email });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.state !== 'completed') process.exitCode = 1;
  } finally { await db.destroy(); }
}
