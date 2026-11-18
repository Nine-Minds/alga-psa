import { describe, expect, it } from 'vitest';
import { applyEmailPalette } from '../applyEmailPalette';
import { classifyTenantTemplate, copiedFromSystemRowFor } from '../classifyTenantTemplate';
import { planEmailBrandingApply, planEmailBrandingRemoval } from '../planEmailBrandingApply';
import { previewEmailBrandingApply } from '../previewEmailBrandingApply';
import { resolveEmailPalette } from '../resolveEmailPalette';
import { STOCK_EMAIL_PALETTE } from '../stockPalette';
import { loadSystemTemplates } from './systemTemplateFixtures';

/**
 * When a client template is split off a shared one, each tenant's shared row is copied to the
 * client name. A copy of a row the branding tool wrote must still read as the tool's own, so the
 * next apply moves it to the client template; a copy of a hand-edited row stays the tenant's.
 */
const TERRACOTTA = resolveEmailPalette({ primary: '#b4552f', secondary: '#3f4d8a' });
const FOREST = resolveEmailPalette({ primary: '#1f7a44', secondary: '#7ac8a1' });

const SHARED = 'ticket-closed';
const CLIENT = 'ticket-closed-client';
const COPIED_FROM = { [CLIENT]: SHARED };

const SYSTEM_ROWS = loadSystemTemplates('en')
  .filter((template) => [SHARED, CLIENT].includes(template.name))
  .map((template, index) => ({
    id: index + 1,
    name: template.name,
    language_code: 'en',
    subject: template.subject,
    html_content: template.html,
    text_content: template.text,
  }));
const stock = (name: string) => SYSTEM_ROWS.find((row) => row.name === name)!;

/** What the split migration leaves under the client name: the tenant's shared row, unchanged. */
const copyOf = (sharedTenantRow: { subject: string; html_content: string; text_content: string }) => ({
  id: 500, name: CLIENT, language_code: 'en', ...sharedTenantRow,
});
const brandedShared = (palette = TERRACOTTA) => ({
  subject: stock(SHARED).subject,
  html_content: applyEmailPalette(stock(SHARED).html_content, STOCK_EMAIL_PALETTE, palette),
  text_content: stock(SHARED).text_content,
});
const handEditedShared = () => ({
  ...brandedShared(),
  html_content: brandedShared().html_content.replace('</body>', '<p>Call us on 555-0100.</p></body>'),
});

describe('classifying a copied client row', () => {
  const classify = (tenantRow: ReturnType<typeof copyOf>, copiedFrom: Record<string, string> | null = COPIED_FROM) =>
    classifyTenantTemplate({
      tenantRow,
      systemRow: stock(CLIENT),
      appliedPalette: TERRACOTTA,
      copiedFromSystemRow: copiedFromSystemRowFor(SYSTEM_ROWS, copiedFrom, CLIENT, 'en'),
    });

  it('has both stock templates to work with', () => {
    expect(SYSTEM_ROWS.map((row) => row.name).sort()).toEqual([SHARED, CLIENT].sort());
    expect(stock(CLIENT).html_content).not.toBe(stock(SHARED).html_content);
  });

  it('reads a copy of a branded shared row as the tool\'s own', () => {
    expect(classify(copyOf(brandedShared()))).toEqual({ state: 'branded', differs: [], copyOfSplitSource: true });
  });

  it('reads a copy of an untouched clone as the tool\'s own when no palette was ever applied', () => {
    const untouched = { subject: stock(SHARED).subject, html_content: stock(SHARED).html_content, text_content: stock(SHARED).text_content };
    expect(classifyTenantTemplate({
      tenantRow: copyOf(untouched), systemRow: stock(CLIENT), copiedFromSystemRow: stock(SHARED),
    })).toMatchObject({ state: 'branded', copyOfSplitSource: true });
  });

  it('keeps a copy of a hand-edited shared row as the tenant\'s', () => {
    expect(classify(copyOf(handEditedShared())).state).toBe('customized');
  });

  it('keeps a copy with an edited subject as the tenant\'s', () => {
    expect(classify(copyOf({ ...brandedShared(), subject: 'Closed: {{ticket.title}}' })).state).toBe('customized');
  });

  it('does not recognise the copy for a template that was not split with a copy', () => {
    expect(classify(copyOf(brandedShared()), null).state).toBe('customized');
  });

  it('still reads a row written from the client template itself as plain branded', () => {
    const ownBranded = {
      id: 500, name: CLIENT, language_code: 'en', subject: stock(CLIENT).subject,
      html_content: applyEmailPalette(stock(CLIENT).html_content, STOCK_EMAIL_PALETTE, TERRACOTTA),
      text_content: stock(CLIENT).text_content,
    };
    expect(classify(ownBranded)).toEqual({ state: 'branded', differs: [] });
  });
});

describe('applying branding over copied client rows', () => {
  const plan = (tenantRows: Array<ReturnType<typeof copyOf>>, scope = {}) => planEmailBrandingApply({
    systemRows: SYSTEM_ROWS,
    tenantRows,
    target: FOREST,
    appliedPalette: TERRACOTTA,
    scope: { names: [CLIENT], languages: ['en'], ...scope },
    copiedFrom: COPIED_FROM,
  });

  it('moves a copied branded row to the client template: its layout, subject and text, in the new colors', () => {
    const result = plan([copyOf(brandedShared())]);

    expect(result.skipped).toEqual([]);
    expect(result.inserts).toEqual([]);
    expect(result.updates).toEqual([{
      id: 500,
      name: CLIENT,
      language: 'en',
      html: applyEmailPalette(stock(CLIENT).html_content, STOCK_EMAIL_PALETTE, FOREST),
      subject: stock(CLIENT).subject,
      text: stock(CLIENT).text_content,
    }]);
  });

  it('leaves a copied hand-edited row alone unless the tenant ticks it', () => {
    const result = plan([copyOf(handEditedShared())]);
    expect(result.updates).toEqual([]);
    expect(result.skipped).toEqual([{ name: CLIENT, language: 'en', state: 'customized', reason: 'customized' }]);
  });

  it('recolors a ticked hand-edited copy and keeps what the tenant typed', () => {
    const result = plan([copyOf(handEditedShared())], { includeCustomized: [CLIENT] });
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].html).toContain('Call us on 555-0100.');
    expect(result.updates[0].subject).toBeUndefined();
  });

  it('previews exactly what the apply would write', () => {
    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [copyOf(brandedShared())],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: CLIENT,
      language: 'en',
      copiedFrom: COPIED_FROM,
    });
    expect(preview).toMatchObject({
      action: 'update',
      state: 'branded',
      subject: stock(CLIENT).subject,
      plannedHtml: applyEmailPalette(stock(CLIENT).html_content, STOCK_EMAIL_PALETTE, FOREST),
    });
  });
});

describe('removing branding with copied client rows', () => {
  it('deletes a copied branded row and keeps a copied hand-edited one', () => {
    const branded = copyOf(brandedShared());
    const edited = { ...copyOf(handEditedShared()), id: 501, language_code: 'fr' };
    const systemRows = [...SYSTEM_ROWS, ...SYSTEM_ROWS.map((row) => ({ ...row, id: row.id + 10, language_code: 'fr' }))];

    const { deletable, kept } = planEmailBrandingRemoval({
      systemRows, tenantRows: [branded, edited], appliedPalette: TERRACOTTA, copiedFrom: COPIED_FROM,
    });
    expect(deletable.map((row) => row.id)).toEqual([500]);
    expect(kept.map((row) => row.id)).toEqual([501]);
  });
});
