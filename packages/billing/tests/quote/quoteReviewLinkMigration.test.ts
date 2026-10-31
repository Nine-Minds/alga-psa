import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../../../server/migrations/20261031090000_add_quote_review_link_to_email_templates.cjs');
const quoteEmail = require('../../../../server/migrations/utils/templates/email/quotes/quoteEmail.cjs');
const quoteReminder = require('../../../../server/migrations/utils/templates/email/quotes/quoteReminder.cjs');

// Minimal knex double capturing system_email_templates upserts.
function fakeKnex() {
  const upserts: any[][] = [];
  const knex: any = (table: string) => {
    if (table === 'notification_subtypes') return { where: () => ({ first: async () => ({ id: 'subtype-1' }) }) };
    return { insert: (rows: any[]) => { upserts.push(rows); return { onConflict: () => ({ merge: async () => undefined }) }; } };
  };
  return { knex, upserts };
}

describe('quote review link email templates', () => {
  it('up writes the review-link bodies for every language; down restores bodies without it', async () => {
    const up = fakeKnex();
    await migration.up(up.knex);
    const down = fakeKnex();
    await migration.down(down.knex);

    expect(up.upserts).toHaveLength(2);
    for (const rows of up.upserts) {
      expect(rows.length).toBeGreaterThanOrEqual(9);
      for (const row of rows) {
        expect(row.html_content).toContain('{{#if quoteReviewLink}}');
        expect(row.text_content).toContain('{{quoteReviewLink}}');
        // portal link stays available as the secondary link and the fallback
        expect(row.html_content).toContain('{{portalLink}}');
      }
    }
    for (const rows of down.upserts) {
      for (const row of rows) {
        expect(row.html_content).not.toContain('quoteReviewLink');
        expect(row.text_content).not.toContain('quoteReviewLink');
        expect(row.html_content).toContain('{{#if portalLink}}');
      }
    }
    expect(down.upserts.map((r) => r[0].name)).toEqual(['quote-email', 'quote-reminder-email']);
  });

  it('source templates expose both shapes', () => {
    for (const t of [quoteEmail, quoteReminder]) {
      expect(t.getTemplate().translations.every((x: any) => x.htmlContent.includes('quoteReviewLink'))).toBe(true);
      expect(t.getTemplate({ reviewLink: false }).translations.some((x: any) => x.htmlContent.includes('quoteReviewLink'))).toBe(false);
    }
  });
});
