import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Handlebars from 'handlebars';
import { describe, expect, it, vi } from 'vitest';

import { ticketEmailSubscriberTestHarness } from '../ticketEmailSubscriber';

const {
  resolveChangeItems,
  resolveAccumulatedChangeGroups,
  flattenChangeGroups,
  formatAccumulatedChanges,
} = ticketEmailSubscriberTestHarness;

const require = createRequire(import.meta.url);
const templatesRoot = path.resolve(__dirname, '../../../../../migrations/utils/templates/email');

const tenant = randomUUID();
const graceId = randomUUID();
const linusId = randomUUID();

// users table stub: only Grace and Linus have rows.
function makeDb() {
  const users = [
    { user_id: graceId, first_name: 'Grace', last_name: 'Hopper' },
    { user_id: linusId, first_name: 'Linus', last_name: 'Torvalds' },
  ];
  const db: any = vi.fn((table: string) => {
    if (table !== 'users') throw new Error(`unexpected table ${table}`);
    const chain: any = {
      where: (w: any) => { chain._one = w.user_id; return chain; },
      first: async () => users.find((u) => u.user_id === chain._one),
    };
    return chain;
  });
  return db;
}

vi.mock('@alga-psa/db', async (orig) => {
  const actual: any = await orig();
  return { ...actual, tenantDb: (conn: any) => ({ table: (n: string) => conn(n), tenantJoin: (q: any) => q }) };
});

const update = (userId: string, changes: Record<string, unknown>) => ({
  timestamp: '2026-11-17T20:04:00.000Z',
  userId,
  changes,
});

function renderEnglish(templateFile: string, context: Record<string, unknown>) {
  const { getTemplate } = require(path.join(templatesRoot, templateFile));
  const en = getTemplate().translations.find((t: { language: string }) => t.language === 'en');
  return {
    html: Handlebars.compile(en.htmlContent)(context),
    text: Handlebars.compile(en.textContent, { noEscape: true })(context),
  };
}

describe('ticket email change items', () => {
  it('resolves a single update into items with an empty oldValue for single values', async () => {
    const items = await resolveChangeItems(makeDb(), {
      title: { old: 'Printer jam', new: 'Printer jam on floor 3' },
      is_closed: true,
    }, tenant);

    expect(items).toEqual([
      { label: 'Title', oldValue: 'Printer jam', newValue: 'Printer jam on floor 3', updatedBy: '', updatedAt: '' },
      { label: 'Is Closed', oldValue: '', newValue: 'Yes', updatedBy: '', updatedAt: '' },
    ]);
  });

  it('flattens bundled updates, putting the updater on the first item of each update only', async () => {
    const groups = await resolveAccumulatedChangeGroups(makeDb(), [
      update(graceId, { title: { old: 'a', new: 'b' }, url: { old: 'x', new: 'y' } }),
      update(linusId, { title: { old: 'b', new: 'c' } }),
    ] as any, tenant);
    const items = flattenChangeGroups(groups);

    expect(items.map((item) => item.updatedBy)).toEqual(['Grace Hopper', '', 'Linus Torvalds']);
    expect(items[0].updatedAt).toMatch(/2026/);
    expect(items[1].updatedAt).toBe('');
    expect(items.map((item) => item.newValue)).toEqual(['b', 'y', 'c']);
  });

  it('keeps the legacy ticket.changes HTML for customized templates', async () => {
    const html = await formatAccumulatedChanges(makeDb(), [update(graceId, { title: { old: 'a', new: 'b' } })] as any, tenant);

    expect(html).toContain('Grace Hopper');
    expect(html).toContain('text-decoration:line-through');
  });
});

describe('stock templates render change items', () => {
  const changeItems = [
    { label: 'Status', oldValue: 'In Progress', newValue: 'Awaiting <Customer>', updatedBy: 'Grace Hopper', updatedAt: 'Nov 17, 2026, 03:04 PM EST' },
    { label: 'Due Date', oldValue: '', newValue: 'Nov 20, 2026', updatedBy: '', updatedAt: '' },
  ];

  it('ticket-updated: one heading per update, strike-through only for a previous value, values escaped', () => {
    const { html, text } = renderEnglish('tickets/ticketUpdated.cjs', { ticket: { changeItems } });

    expect(html.match(/Grace Hopper/g)).toHaveLength(1);
    expect(html.match(/text-decoration:line-through/g)).toHaveLength(1);
    expect(html).toContain('Awaiting &lt;Customer&gt;');
    expect(html).not.toMatch(/#fff9e6|#92400e|#0a7c3c/i);
    expect(text).toContain('Grace Hopper · Nov 17, 2026, 03:04 PM EST');
    expect(text).toContain('- Status: In Progress → Awaiting <Customer>');
    expect(text).toContain('- Due Date: Nov 20, 2026');
  });

  it('ticket-updated-client lays out the same items', () => {
    const { html } = renderEnglish('tickets/ticketUpdatedClient.cjs', { ticket: { changeItems } });

    expect(html).toContain('In Progress');
    expect(html).toContain('Nov 20, 2026');
    expect(html).not.toContain('{{');
  });

  it('project-updated and project-closed print no updater heading', () => {
    for (const file of ['projects/projectUpdated.cjs', 'projects/projectClosed.cjs']) {
      const { html } = renderEnglish(file, { project: { changeItems } });
      expect(html, file).toContain('Awaiting &lt;Customer&gt;');
      expect(html, file).not.toContain('Grace Hopper');
    }
  });
});
