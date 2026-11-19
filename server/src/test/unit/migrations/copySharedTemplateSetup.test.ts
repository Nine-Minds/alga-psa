import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  planTemplateCopies, planSubtypeSettingCopies, planPreferenceCopies, groupByTenant,
} = require(path.resolve(__dirname, '../../../../migrations/utils/templates/_shared/copySharedTemplateSetup.cjs'));

const PAIRS = [
  { from: 'ticket-closed', to: 'ticket-closed-client' },
  { from: 'ticket-comment-added', to: 'ticket-comment-added-client' },
];
const SYSTEM = [
  { id: 901, name: 'ticket-closed-client', language_code: 'en' },
  { id: 902, name: 'ticket-closed-client', language_code: 'fr' },
  { id: 911, name: 'ticket-comment-added-client', language_code: 'en' },
];
const shared = (tenant: string, name: string, language: string | null, marker: string) => ({
  id: 1, tenant, name, language_code: language, subject: `${marker} subject`, html_content: `<p>${marker}</p>`, text_content: marker,
});

describe('planTemplateCopies', () => {
  it('copies a shared row under the client name with its content and language unchanged', () => {
    const { inserts, skipped } = planTemplateCopies({
      pairs: PAIRS, sourceRows: [shared('t1', 'ticket-closed', 'fr', 'CUSTOM')], existingRows: [], systemRows: SYSTEM,
    });
    expect(skipped).toEqual([]);
    expect(inserts).toEqual([{
      tenant: 't1', name: 'ticket-closed-client', language_code: 'fr',
      subject: 'CUSTOM subject', html_content: '<p>CUSTOM</p>', text_content: 'CUSTOM', system_template_id: 902,
    }]);
  });

  it('never replaces a client row a tenant already has', () => {
    const { inserts, skipped } = planTemplateCopies({
      pairs: PAIRS,
      sourceRows: [shared('t1', 'ticket-closed', 'en', 'A'), shared('t1', 'ticket-closed', 'fr', 'B')],
      existingRows: [{ tenant: 't1', name: 'ticket-closed-client', language_code: 'en' }],
      systemRows: SYSTEM,
    });
    expect(inserts.map((row: any) => row.language_code)).toEqual(['fr']);
    expect(skipped).toEqual([{ tenant: 't1', name: 'ticket-closed-client', language_code: 'en' }]);
  });

  it('keeps tenants apart: one tenant\'s client row does not block another tenant\'s copy', () => {
    const { inserts } = planTemplateCopies({
      pairs: PAIRS,
      sourceRows: [shared('t1', 'ticket-closed', 'en', 'A'), shared('t2', 'ticket-closed', 'en', 'B')],
      existingRows: [{ tenant: 't1', name: 'ticket-closed-client', language_code: 'en' }],
      systemRows: SYSTEM,
    });
    expect(inserts.map((row: any) => [row.tenant, row.text_content])).toEqual([['t2', 'B']]);
  });

  it('copies a legacy row with no language, and leaves the stock link empty when there is no stock row', () => {
    const { inserts } = planTemplateCopies({
      pairs: PAIRS,
      sourceRows: [shared('t1', 'ticket-comment-added', null, 'LEGACY'), shared('t1', 'ticket-comment-added', 'de', 'DE')],
      existingRows: [], systemRows: SYSTEM,
    });
    expect(inserts.map((row: any) => [row.language_code, row.system_template_id])).toEqual([[null, null], ['de', null]]);
  });

  it('ignores templates that are not being split, and plans a duplicated source row once', () => {
    const row = shared('t1', 'ticket-closed', 'en', 'A');
    const { inserts } = planTemplateCopies({
      pairs: PAIRS, sourceRows: [row, row, shared('t1', 'ticket-created', 'en', 'X')], existingRows: [], systemRows: SYSTEM,
    });
    expect(inserts).toHaveLength(1);
  });

  it('plans nothing on a second run', () => {
    const sourceRows = [shared('t1', 'ticket-closed', 'en', 'A'), shared('t2', 'ticket-comment-added', 'en', 'B')];
    const first = planTemplateCopies({ pairs: PAIRS, sourceRows, existingRows: [], systemRows: SYSTEM });
    const second = planTemplateCopies({ pairs: PAIRS, sourceRows, existingRows: first.inserts, systemRows: SYSTEM });
    expect(first.inserts).toHaveLength(2);
    expect(second.inserts).toEqual([]);
    expect(second.skipped).toHaveLength(2);
  });
});

describe('planSubtypeSettingCopies', () => {
  const pairs = [{ fromId: 16, toId: 516 }];
  const setting = (tenant: string, is_enabled: boolean, is_default_enabled = true, subtype_id = 16) =>
    ({ tenant, subtype_id, is_enabled, is_default_enabled });

  it('copies a switched-off setting to the client subtype', () => {
    expect(planSubtypeSettingCopies({ pairs, sourceRows: [setting('t1', false)], existingRows: [] }).inserts)
      .toEqual([{ tenant: 't1', subtype_id: 516, is_enabled: false, is_default_enabled: true }]);
  });

  it('copies a row that only changes the default for users', () => {
    expect(planSubtypeSettingCopies({ pairs, sourceRows: [setting('t1', true, false)], existingRows: [] }).inserts)
      .toEqual([{ tenant: 't1', subtype_id: 516, is_enabled: true, is_default_enabled: false }]);
  });

  it('writes nothing for a tenant on the default, which needs no row to stay on', () => {
    expect(planSubtypeSettingCopies({ pairs, sourceRows: [setting('t1', true)], existingRows: [] }).inserts).toEqual([]);
  });

  it('leaves a client setting the tenant already has, and other subtypes', () => {
    expect(planSubtypeSettingCopies({
      pairs,
      sourceRows: [setting('t1', false), setting('t2', false, true, 99)],
      existingRows: [{ tenant: 't1', subtype_id: 516 }],
    }).inserts).toEqual([]);
  });
});

describe('planPreferenceCopies', () => {
  const pairs = [{ fromId: 16, toId: 516 }];
  const preference = (user_id: string, is_enabled: boolean) =>
    ({ tenant: 't1', user_id, subtype_id: 16, is_enabled, email_address: null, frequency: 'realtime' });

  it('copies opt-outs only', () => {
    expect(planPreferenceCopies({
      pairs, sourceRows: [preference('u1', false), preference('u2', true)], existingRows: [],
    }).inserts).toEqual([
      { tenant: 't1', user_id: 'u1', subtype_id: 516, is_enabled: false, email_address: null, frequency: 'realtime' },
    ]);
  });

  it('leaves a preference the user already has for the client subtype', () => {
    expect(planPreferenceCopies({
      pairs, sourceRows: [preference('u1', false)], existingRows: [{ tenant: 't1', user_id: 'u1', subtype_id: 516 }],
    }).inserts).toEqual([]);
  });
});

describe('groupByTenant', () => {
  it('puts each tenant\'s rows in one group, in order', () => {
    const groups = groupByTenant([{ tenant: 'a', n: 1 }, { tenant: 'b', n: 2 }, { tenant: 'a', n: 3 }]);
    expect([...groups.keys()]).toEqual(['a', 'b']);
    expect(groups.get('a').map((row: any) => row.n)).toEqual([1, 3]);
  });
});
