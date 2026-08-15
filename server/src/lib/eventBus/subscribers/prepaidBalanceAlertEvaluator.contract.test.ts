import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'prepaidBalanceAlertEvaluator.ts'), 'utf8');

describe('prepaid balance alert evaluator wiring contract', () => {
  it('pins bucket usage rows to the evaluated client (shared contract lines)', () => {
    expect(source).toContain("join.andOn('bu.service_catalog_id', '=', 'psc.service_id');");
    expect(source).toContain("join.andOn('bu.client_id', '=', 'cc.client_id');");
  });

  it('uses only the usage period and configured percentage as the bucket identity', () => {
    expect(source).not.toContain('nextBucketEpisode');
    expect(source).toContain('findBucketAlertByIdentity(db, subject.usage_id, percent)');
    expect(source).toContain("dedupe_key: bucketDedupeKey(subject.usage_id, percent),");
  });

  it('evaluates credit and buckets in separate per-client transactions', () => {
    const perClientBlock = source.slice(source.indexOf('for (const candidate of candidates.values())'));
    expect(perClientBlock).toContain('await knex.transaction(async (trx) => {');
    // The credit transaction and the bucket transaction are distinct blocks.
    expect(perClientBlock).toContain('await evaluateClientCredit(trx, tenantId, client, summary);');
    expect(perClientBlock).toContain('await evaluateClientBuckets(trx, tenantId, client, summary, todayISO);');
    expect(perClientBlock).toContain('Credit evaluation failed');
    expect(perClientBlock).toContain('Bucket evaluation failed');
  });

  it('includes open-alert clients and resolves disabled policies under the settings-row lock', () => {
    expect(source).toContain('loadOpenAlertClients(knex, tenantId, clientId)');
    expect(source).toContain('const client = await lockSettingsRow(trx, candidate);');
    expect(source).toContain("summary.creditAlertsResolved += await resolveDisabledType(trx, client.client_id, 'credit');");
    expect(source).toContain("summary.bucketAlertsResolved += await resolveDisabledType(trx, client.client_id, 'bucket');");
    expect(source).toContain('RESOLUTION_REASON_POLICY_CHANGED');
  });

  it('does not resolve a bucket episode on recovery within the same period (oscillation suppressed)', () => {
    // One alert per (bucket_usage, period, percentage): consumption oscillating
    // around the threshold must never re-alert, so recovery must NOT resolve.
    const bucketBlock = source.slice(source.indexOf('async function evaluateClientBuckets'));
    expect(bucketBlock).toContain('bucketPolicyChanged(Number(open.bucket_percent), percent)');
    // No recovery-resolve branch for a same-policy open bucket episode.
    expect(bucketBlock).not.toMatch(/else if \(!reached\)/);
    expect(bucketBlock).toContain('if (!reached) {');
    expect(bucketBlock).toContain('continue;');
  });
});
