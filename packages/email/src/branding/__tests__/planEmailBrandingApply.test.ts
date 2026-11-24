import { describe, expect, it } from 'vitest';
import { applyEmailPalette, containsEmailPaletteTokens } from '../applyEmailPalette';
import {
  BRAND_LOGO_MARKER,
  containsBrandAttribution,
  decorateBrandedHtml,
  type BrandAttributionStripOptions,
} from '../brandAssets';
import { LEGACY_BRAND_SLOGANS } from '../orphanedSlogan';
import { planEmailBrandingApply, planEmailBrandingRemoval } from '../planEmailBrandingApply';
import { resolveEmailPalette } from '../resolveEmailPalette';
import { STOCK_EMAIL_PALETTE } from '../stockPalette';
import { loadSystemTemplates } from './systemTemplateFixtures';

const TERRACOTTA = resolveEmailPalette({ primary: '#b4552f', secondary: '#3f4d8a' });
const FOREST = resolveEmailPalette({ primary: '#1f7a44', secondary: '#7ac8a1' });

const NAMES = ['ticket-created', 'ticket-closed', 'invoice-email'];

/** Three real English templates, mirrored into a second language. */
function systemRows() {
  const english = loadSystemTemplates('en').filter((template) => NAMES.includes(template.name));
  expect(english).toHaveLength(NAMES.length);

  let id = 1;
  return ['en', 'fr'].flatMap((language) =>
    english.map((template) => ({
      id: id++,
      name: template.name,
      language_code: language,
      subject: template.subject,
      html_content: template.html,
      text_content: template.text,
    })),
  );
}

const SYSTEM_ROWS = systemRows();
const SCOPE = { names: NAMES, languages: ['en', 'fr'] };

const brandedRow = (id: number, name: string, language: string, palette = TERRACOTTA) => {
  const systemRow = SYSTEM_ROWS.find((row) => row.name === name && row.language_code === language)!;
  return {
    id,
    name,
    language_code: language,
    subject: systemRow.subject,
    html_content: applyEmailPalette(systemRow.html_content, STOCK_EMAIL_PALETTE, palette),
    text_content: systemRow.text_content,
  };
};

describe('planEmailBrandingApply', () => {
  it('creates a branded clone for every system row in scope', () => {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      scope: SCOPE,
    });

    expect(plan.inserts).toHaveLength(6);
    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);

    for (const insert of plan.inserts) {
      expect(containsEmailPaletteTokens(insert.html, STOCK_EMAIL_PALETTE)).toBe(false);
      expect(insert.html).toContain(TERRACOTTA.primary);
      expect(insert.systemTemplateId).toBeGreaterThan(0);
    }
  });

  it('respects the selected names and languages', () => {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      scope: { names: ['ticket-created'], languages: ['en'] },
    });

    expect(plan.inserts.map((insert) => `${insert.name}/${insert.language}`)).toEqual(['ticket-created/en']);
  });

  it('recolors its own rows on a re-apply, leaving no trace of the first palette', () => {
    const tenantRows = SYSTEM_ROWS.map((row, index) => brandedRow(100 + index, row.name, row.language_code));

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
    });

    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(6);

    for (const update of plan.updates) {
      expect(containsEmailPaletteTokens(update.html, TERRACOTTA)).toBe(false);
      expect(containsEmailPaletteTokens(update.html, STOCK_EMAIL_PALETTE)).toBe(false);
      expect(update.html).toContain(FOREST.primary);
    }
  });

  it('skips a re-apply of the identical palette instead of rewriting rows', () => {
    const tenantRows = SYSTEM_ROWS.map((row, index) => brandedRow(100 + index, row.name, row.language_code));

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: TERRACOTTA,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
    });

    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped.every((skip) => skip.reason === 'unchanged')).toBe(true);
  });

  it('leaves an unticked customized row alone and reports it', () => {
    const customized = brandedRow(200, 'ticket-created', 'en');
    customized.html_content = customized.html_content.replace('View Ticket', 'Open in our portal');
    const before = customized.html_content;

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [customized],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
    });

    expect(plan.updates.some((update) => update.id === 200)).toBe(false);
    expect(plan.skipped).toContainEqual({
      name: 'ticket-created',
      language: 'en',
      state: 'customized',
      reason: 'customized',
    });
    expect(customized.html_content).toBe(before);
  });

  it('replaces only the color tokens of a ticked customized row', () => {
    const customized = brandedRow(200, 'ticket-created', 'en');
    customized.html_content = customized.html_content.replace('View Ticket', 'Open in our portal');

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [customized],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: { ...SCOPE, includeCustomized: ['ticket-created'] },
    });

    const update = plan.updates.find((candidate) => candidate.id === 200)!;
    expect(update).toBeDefined();
    expect(update.html).toContain('Open in our portal');
    expect(update.html).toContain(FOREST.primary);
    expect(containsEmailPaletteTokens(update.html, TERRACOTTA)).toBe(false);
  });

  it('rewrites the stock tokens a customized row kept, alongside the applied ones', () => {
    const systemRow = SYSTEM_ROWS.find((row) => row.name === 'ticket-created' && row.language_code === 'en')!;
    const halfBranded = {
      id: 300,
      name: systemRow.name,
      language_code: 'en',
      subject: systemRow.subject,
      // Only the gradient was ever recolored; the rest still carries stock.
      html_content: systemRow.html_content.replace(STOCK_EMAIL_PALETTE.gradient, TERRACOTTA.gradient),
      text_content: systemRow.text_content,
    };

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [halfBranded],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: { ...SCOPE, includeCustomized: ['ticket-created'] },
    });

    const update = plan.updates.find((candidate) => candidate.id === 300)!;
    expect(containsEmailPaletteTokens(update.html, STOCK_EMAIL_PALETTE)).toBe(false);
    expect(containsEmailPaletteTokens(update.html, TERRACOTTA)).toBe(false);
  });

  it('never writes a row with no recognizable tokens', () => {
    const redesign = {
      id: 400,
      name: 'ticket-created',
      language_code: 'en',
      subject: 'Ticket raised',
      html_content: '<html><head><style>body{background:#0b0b12}</style></head><body>{{ticket.title}}</body></html>',
      text_content: 'Ticket raised',
    };

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [redesign],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: { ...SCOPE, includeCustomized: ['ticket-created'] },
    });

    expect(plan.updates.some((update) => update.id === 400)).toBe(false);
    expect(plan.skipped).toContainEqual({
      name: 'ticket-created',
      language: 'en',
      state: 'no-stock-colors',
      reason: 'nothing-to-replace',
    });
  });

  it('rebuilds a customized row from the standard template when it is overwritten', () => {
    const customized = brandedRow(200, 'ticket-created', 'en');
    customized.html_content = customized.html_content
      .replace('View Ticket', 'Open in our portal')
      .replace(TERRACOTTA.footerBg, '#101014');
    customized.subject = 'A ticket needs you';

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [customized],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: { ...SCOPE, overwrite: ['ticket-created'] },
    });

    const update = plan.updates.find((candidate) => candidate.id === 200)!;
    expect(update).toBeDefined();
    // The edits go, the standard copy in the new palette arrives.
    expect(update.html).not.toContain('Open in our portal');
    expect(update.html).not.toContain('#101014');
    expect(update.html).toContain(FOREST.primary);
    const standard = SYSTEM_ROWS.find((row) => row.name === 'ticket-created' && row.language_code === 'en')!;
    expect(update.subject).toBe(standard.subject);
    expect(update.text).toBe(standard.text_content);
  });

  it('overwrites a redesigned row that carries none of our colors', () => {
    const redesign = {
      id: 400,
      name: 'ticket-created',
      language_code: 'en',
      subject: 'Ticket raised',
      html_content: '<html><head><style>body{background:#0b0b12}</style></head><body>{{ticket.title}}</body></html>',
      text_content: 'Ticket raised',
    };

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [redesign],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: { ...SCOPE, overwrite: ['ticket-created'] },
    });

    const update = plan.updates.find((candidate) => candidate.id === 400)!;
    expect(update).toBeDefined();
    expect(update.html).toContain(FOREST.primary);
    expect(containsEmailPaletteTokens(update.html, STOCK_EMAIL_PALETTE)).toBe(false);
    expect(plan.skipped.some((skip) => skip.reason === 'nothing-to-replace')).toBe(false);
  });

  it('touches nothing an overwrite would leave identical', () => {
    const tenantRows = SYSTEM_ROWS.map((row, index) => brandedRow(100 + index, row.name, row.language_code));

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: TERRACOTTA,
      appliedPalette: TERRACOTTA,
      scope: { ...SCOPE, overwrite: NAMES },
    });

    expect(plan.updates).toHaveLength(0);
    expect(plan.skipped.every((skip) => skip.reason === 'unchanged')).toBe(true);
  });

  it('leaves the other names alone when only one is overwritten', () => {
    const customized = brandedRow(200, 'ticket-created', 'en');
    customized.html_content = customized.html_content.replace('View Ticket', 'Open in our portal');
    const other = brandedRow(201, 'ticket-closed', 'en');
    other.html_content = other.html_content.replace('View Ticket', 'See the ticket');

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [customized, other],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: { ...SCOPE, overwrite: ['ticket-created'] },
    });

    expect(plan.updates.find((update) => update.id === 200)!.html).not.toContain('Open in our portal');
    expect(plan.skipped).toContainEqual({
      name: 'ticket-closed',
      language: 'en',
      state: 'customized',
      reason: 'customized',
    });
  });

  it('accounts for every selected row exactly once', () => {
    const customized = brandedRow(200, 'ticket-created', 'en');
    customized.html_content = customized.html_content.replace('View Ticket', 'Open in our portal');

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [customized, brandedRow(201, 'ticket-closed', 'en')],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
    });

    expect(plan.inserts.length + plan.updates.length + plan.skipped.length).toBe(SYSTEM_ROWS.length);
  });

  it('clones the plain-text body verbatim and never plans a text change', () => {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      scope: SCOPE,
    });

    for (const insert of plan.inserts) {
      const systemRow = SYSTEM_ROWS.find(
        (row) => row.name === insert.name && row.language_code === insert.language,
      )!;
      expect(insert.text).toBe(systemRow.text_content);
    }
    expect(plan.updates.every((update) => !('text' in update))).toBe(true);
  });

  it('runs a decorate pass over generated HTML', () => {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      scope: { names: ['ticket-created'], languages: ['en'] },
      decorate: (html) => `${html}<!--decorated-->`,
    });

    expect(plan.inserts[0].html.endsWith('<!--decorated-->')).toBe(true);
  });
});

describe('planEmailBrandingRemoval', () => {
  it('deletes branded rows and keeps customized ones', () => {
    const branded = brandedRow(500, 'ticket-created', 'en');
    const customized = brandedRow(501, 'ticket-closed', 'en');
    customized.subject = 'Ticket resolved';

    const { deletable, kept } = planEmailBrandingRemoval({
      systemRows: SYSTEM_ROWS,
      tenantRows: [branded, customized],
      appliedPalette: TERRACOTTA,
    });

    expect(deletable.map((row) => row.id)).toEqual([500]);
    expect(kept.map((row) => row.id)).toEqual([501]);
  });

  it('keeps a row whose system template no longer exists', () => {
    const orphan = {
      id: 600,
      name: 'retired-template',
      language_code: 'en',
      subject: 'Gone',
      html_content: '<html></html>',
      text_content: 'Gone',
    };

    const { deletable, kept } = planEmailBrandingRemoval({
      systemRows: SYSTEM_ROWS,
      tenantRows: [orphan],
      appliedPalette: TERRACOTTA,
    });

    expect(deletable).toHaveLength(0);
    expect(kept.map((row) => row.id)).toEqual([600]);
  });
});

describe('enterprise brand assets in the plan', () => {
  const logo = { variant: 'wide' as const, alt: 'Acme MSP' };
  // Forwards the planner's strip options, exactly as buildBrandDecorator does.
  const decorate = (html: string, options?: BrandAttributionStripOptions) =>
    decorateBrandedHtml(html, { logo, hideAttribution: true, ...options });

  function applyOnce() {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      scope: SCOPE,
      decorate,
    });

    return plan.inserts.map((insert, index) => ({
      id: 700 + index,
      name: insert.name,
      language_code: insert.language,
      subject: insert.subject,
      html_content: insert.html,
      text_content: insert.text,
    }));
  }

  it('writes the logo and drops the attribution on the rows it creates', () => {
    for (const row of applyOnce()) {
      expect(row.html_content).toContain(BRAND_LOGO_MARKER);
      expect(containsBrandAttribution(row.html_content)).toBe(false);
    }
  });

  it('leaves no AlgaPSA slogan behind in anything it writes', () => {
    const inserts = applyOnce();
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: inserts,
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
      decorate,
    });

    expect(plan.updates).toHaveLength(6);
    for (const html of [...inserts.map((row) => row.html_content), ...plan.updates.map((update) => update.html)]) {
      expect(containsBrandAttribution(html)).toBe(false);
      expect(LEGACY_BRAND_SLOGANS.filter((slogan) => html.includes(slogan))).toEqual([]);
    }
  });

  /** The attribution strip as it shipped before the fix: the slogan survived it. */
  const legacyStrip = (html: string) => html
    .replace(/<p>\s*Powered by AlgaPSA\s*<\/p>/gi, '')
    .replace(/\s*&middot;\s*Powered by AlgaPSA/gi, '')
    .replace(/Powered by AlgaPSA\s*&middot;\s*/gi, '')
    .replace(/Powered by AlgaPSA/gi, '');

  /** Rows as the old apply wrote them: an orphaned slogan, or an empty band. */
  function storedBeforeTheFix() {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      scope: SCOPE,
      decorate: (html: string) => legacyStrip(decorateBrandedHtml(html, { logo })),
    });

    return plan.inserts.map((insert, index) => ({
      id: 800 + index,
      name: insert.name,
      language_code: insert.language,
      subject: insert.subject,
      html_content: insert.html,
      text_content: insert.text,
    }));
  }

  const EMPTY_FOOTER_BAND = /<tr[^>]*>\s*<td[^>]*>\s*<\/td>\s*<\/tr>/;

  /**
   * How an existing tenant picks up the fix: "Apply to templates" again, with
   * the branding settings exactly as they were. Their stored copies carry what
   * the old strip left — the bare slogan, or the empty band where the footer
   * was the attribution alone (alga-2026-0003353) — so an apply that changes no
   * setting must still rewrite that footer instead of reporting the rows as
   * already up to date.
   */
  it('rewrites copies left on an orphaned slogan, branding unchanged', () => {
    const stored = storedBeforeTheFix();
    expect(stored).toHaveLength(6);
    for (const row of stored) {
      const slogans = LEGACY_BRAND_SLOGANS.filter((slogan) => row.html_content.includes(slogan));
      expect(slogans.length > 0 || EMPTY_FOOTER_BAND.test(row.html_content)).toBe(true);
    }

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: stored,
      target: TERRACOTTA,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
      decorate,
    });

    expect(plan.skipped).toEqual([]);
    expect(plan.updates).toHaveLength(6);
    for (const update of plan.updates) {
      expect(containsBrandAttribution(update.html)).toBe(false);
      expect(LEGACY_BRAND_SLOGANS.filter((slogan) => update.html.includes(slogan))).toEqual([]);
      expect(update.html).not.toMatch(EMPTY_FOOTER_BAND);
    }
  });

  /**
   * The other side of the same rule: hiding the attribution takes the whole
   * footer row, but only where that row is ours. A tenant who kept the
   * attribution and wrote their own line beside it owns that footer, so neither
   * an apply nor a removal may touch the row.
   */
  it('neither rewrites nor deletes a footer the tenant reworded', () => {
    const tenantRows = NAMES.map((name, index) => {
      const row = brandedRow(900 + index, name, 'en');
      const html = row.html_content.replace(
        /Powered by AlgaPSA(?:\s*&middot;\s*[^<]*)?/,
        'Powered by AlgaPSA &middot; Acme MSP, your IT partner',
      );

      expect(html).not.toBe(row.html_content);
      return { ...row, html_content: html };
    });

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: TERRACOTTA,
      appliedPalette: TERRACOTTA,
      scope: { names: NAMES, languages: ['en'] },
      decorate,
    });

    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toHaveLength(3);
    expect(plan.skipped.every((skip) => skip.state === 'customized' && skip.reason === 'customized')).toBe(true);

    const removal = planEmailBrandingRemoval({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      appliedPalette: TERRACOTTA,
    });

    expect(removal.deletable).toEqual([]);
    expect(removal.kept).toHaveLength(3);
  });

  /**
   * And when that same tenant does tick the template, so the apply recolors
   * their row in place: hiding the attribution takes the attribution, not the
   * line they wrote beside it. The row is theirs, so only a footer we shipped
   * may be carried off with the attribution — the rest of the cell stays, and
   * does not open on the separator that used to join it to our line.
   */
  it('keeps the words beside the attribution in a ticked customized row', () => {
    const tenantRows = NAMES.map((name, index) => {
      const row = brandedRow(950 + index, name, 'en');
      const html = row.html_content.replace(
        /Powered by AlgaPSA(?:\s*&middot;\s*[^<]*)?/,
        'Powered by AlgaPSA &middot; Acme MSP &middot; +1 555 0100',
      );

      expect(html).not.toBe(row.html_content);
      return { ...row, html_content: html };
    });

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: { names: NAMES, languages: ['en'], includeCustomized: NAMES },
      decorate,
    });

    expect(plan.skipped).toEqual([]);
    expect(plan.updates).toHaveLength(3);
    for (const update of plan.updates) {
      expect(update.html).toContain('Acme MSP');
      expect(update.html).toContain('+1 555 0100');
      expect(containsBrandAttribution(update.html)).toBe(false);
      expect(update.html).not.toMatch(/<td[^>]*>\s*(?:&middot;|&#183;|·|•)/);
    }
  });

  /**
   * The consequence of reading a missing footer row as ours
   * (see classifyTenantTemplate.ts): a tenant who deleted the row by hand gets
   * it back on the next apply, because deleting it is indistinguishable from
   * the row an apply writes with the attribution hidden. The Enterprise toggle
   * is the supported way to drop that footer, and it keeps working.
   */
  it('restores a footer row the tenant deleted by hand', () => {
    const footerRow = /<tr[^>]*>\s*<td[^>]*>\s*Powered by AlgaPSA[^<]*<\/td>\s*<\/tr>/;
    const tenantRows = NAMES.map((name, index) => {
      const row = brandedRow(980 + index, name, 'en');
      expect(row.html_content).toMatch(footerRow);
      return { ...row, html_content: row.html_content.replace(footerRow, '') };
    });

    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: TERRACOTTA,
      appliedPalette: TERRACOTTA,
      scope: { names: NAMES, languages: ['en'] },
      decorate: (html: string) => decorateBrandedHtml(html, { logo }),
    });

    expect(plan.skipped).toEqual([]);
    expect(plan.updates).toHaveLength(3);
    for (const update of plan.updates) {
      expect(containsBrandAttribution(update.html)).toBe(true);
    }
  });

  it('still recognizes those rows as its own on a re-apply', () => {
    const tenantRows = applyOnce();
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: TERRACOTTA,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
      decorate,
    });

    expect(plan.skipped.every((skip) => skip.reason === 'unchanged')).toBe(true);
    expect(plan.updates).toHaveLength(0);
  });

  it('leaves exactly one logo when the palette changes', () => {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: applyOnce(),
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
      decorate,
    });

    expect(plan.updates).toHaveLength(6);
    for (const update of plan.updates) {
      expect((update.html.match(new RegExp(BRAND_LOGO_MARKER, 'g')) ?? [])).toHaveLength(1);
    }
  });

  it('restores the system footer when attribution is turned back on', () => {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: applyOnce(),
      target: TERRACOTTA,
      appliedPalette: TERRACOTTA,
      scope: SCOPE,
      decorate: (html: string) => decorateBrandedHtml(html, { logo }),
    });

    expect(plan.updates).toHaveLength(6);
    for (const update of plan.updates) {
      expect(containsBrandAttribution(update.html)).toBe(true);
    }
  });

  it('writes no logo and keeps the attribution without a decorator (Community)', () => {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      scope: SCOPE,
    });

    for (const insert of plan.inserts) {
      expect(insert.html).not.toContain(BRAND_LOGO_MARKER);
    }
    expect(plan.inserts.some((insert) => containsBrandAttribution(insert.html))).toBe(true);
  });
});
