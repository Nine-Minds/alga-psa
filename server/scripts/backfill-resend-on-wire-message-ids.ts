#!/usr/bin/env tsx
/**
 * Backfill email_sending_logs.rfc_message_id with Resend's on-wire Message-ID for one tenant
 * (alga0002306). Safe to re-run and to stop (Ctrl-C) and resume: rows that already hold an on-wire id
 * are skipped, rows Resend no longer returns are left as they are, and every write goes through the
 * shared reconcileOnWireMessageId operation, so a second run changes nothing.
 *
 * Run inside a server pod (RESEND_API_KEY is the platform key the sends used):
 *   npx tsx scripts/backfill-resend-on-wire-message-ids.ts --tenant <id> [--dry-run] [--limit N]
 *       [--after-id <id>] [--min-interval-ms 250] [--api-key-env RESEND_API_KEY]
 *
 * Output is counts and ids only, never the API key. Exits non-zero if any row errored.
 */

import knex from 'knex';
import { createRequire } from 'module';
import { backfillResendOnWireMessageIds, createResendRetrieve } from '@alga-psa/email/backfillResendOnWireMessageIds';

const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

async function run() {
  const argv = process.argv.slice(2);
  const tenant = option(argv, '--tenant');
  if (!tenant) {
    console.error('--tenant <id> is required');
    process.exitCode = 2;
    return;
  }
  const apiKey = process.env[option(argv, '--api-key-env') ?? 'RESEND_API_KEY']?.trim();
  if (!apiKey) {
    console.error('Resend API key not found in the environment (RESEND_API_KEY or --api-key-env <NAME>).');
    process.exitCode = 2;
    return;
  }
  const limit = option(argv, '--limit');
  const minInterval = option(argv, '--min-interval-ms');
  const dryRun = argv.includes('--dry-run');

  const knexInstance = knex(knexConfig[process.env.NODE_ENV || 'development']);
  try {
    const summary = await backfillResendOnWireMessageIds(knexInstance, {
      tenant,
      dryRun,
      retrieve: createResendRetrieve(apiKey),
      afterId: option(argv, '--after-id') ?? null,
      limit: limit ? Number(limit) : undefined,
      minIntervalMs: minInterval ? Number(minInterval) : undefined,
      onProgress: (line) => console.log(`[tenant=${tenant}] ${line}`),
    });
    console.log(`${dryRun ? '[dry-run] ' : ''}Done. ${JSON.stringify(summary)}`);
    if (summary.lastId !== null) console.log(`Resume with --after-id ${summary.lastId}`);
    if (summary.errors > 0) process.exitCode = 1;
  } catch (error) {
    console.error('Resend on-wire Message-ID backfill failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await knexInstance.destroy();
  }
}

run();
