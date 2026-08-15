import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'prepaidBalanceAlertEvaluator.ts'), 'utf8');

describe('prepaid balance alert evaluator wiring contract', () => {
  it('pins bucket usage rows to the evaluated client (shared contract lines)', () => {
    expect(source).toContain("join.andOn('bu.service_catalog_id', '=', 'psc.service_id');");
    expect(source).toContain("join.andOn('bu.client_id', '=', 'cc.client_id');");
  });

  it('uses episode-aware bucket dedupe keys so a re-opened subject never collides', () => {
    expect(source).toContain('nextBucketEpisode(db, tenantId, client.client_id, subject.usage_id)');
    expect(source).toContain('bucketDedupeKey(subject.usage_id, percent, episode)');
    expect(source).toContain("dedupe_key: bucketDedupeKey(subject.usage_id, percent, episode),");
  });

  it('evaluates credit and buckets in separate per-client transactions', () => {
    const perClientBlock = source.slice(source.indexOf('for (const client of configured)'));
    expect(perClientBlock).toContain('await knex.transaction(async (trx) => {');
    // The credit transaction and the bucket transaction are distinct blocks.
    expect(perClientBlock).toContain('await evaluateClientCredit(trx, tenantId, client, summary);');
    expect(perClientBlock).toContain('await evaluateClientBuckets(trx, tenantId, client, summary, todayISO);');
    expect(perClientBlock).toContain('Credit evaluation failed');
    expect(perClientBlock).toContain('Bucket evaluation failed');
  });
});
