import { describe, expect, it } from 'vitest';
import { applyEmailPalette, containsEmailPaletteTokens } from '../applyEmailPalette';
import { BRAND_LOGO_MARKER, decorateBrandedHtml } from '../brandAssets';
import { planEmailBrandingApply } from '../planEmailBrandingApply';
import { previewEmailBrandingApply } from '../previewEmailBrandingApply';
import { resolveEmailPalette } from '../resolveEmailPalette';
import { STOCK_EMAIL_PALETTE } from '../stockPalette';
import { loadSystemTemplates } from './systemTemplateFixtures';

const TERRACOTTA = resolveEmailPalette({ primary: '#b4552f', secondary: '#3f4d8a' });
const FOREST = resolveEmailPalette({ primary: '#1f7a44', secondary: '#7ac8a1' });

const NAMES = ['ticket-created', 'ticket-closed', 'invoice-email'];

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

const systemRow = (name: string, language: string) =>
  SYSTEM_ROWS.find((row) => row.name === name && row.language_code === language)!;

const brandedRow = (id: number, name: string, language: string, palette = TERRACOTTA) => {
  const source = systemRow(name, language);
  return {
    id,
    name,
    language_code: language,
    subject: source.subject,
    html_content: applyEmailPalette(source.html_content, STOCK_EMAIL_PALETTE, palette),
    text_content: source.text_content,
  };
};

/** A tenant row with both a text edit and a color of their own. */
const customizedRow = (id: number, name: string, language: string) => {
  const row = brandedRow(id, name, language);
  row.html_content = row.html_content
    .replace('View Ticket', 'Open in our portal')
    .replace(TERRACOTTA.footerBg, '#101014');
  row.subject = 'A ticket needs you';
  return row;
};

describe('previewEmailBrandingApply', () => {
  it('previews a branded clone for a template the tenant never touched', () => {
    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
    })!;

    expect(preview.action).toBe('create');
    expect(preview.state).toBe('system');
    expect(preview.skipReason).toBeUndefined();
    expect(preview.currentHtml).toBe(systemRow('ticket-created', 'en').html_content);
    expect(preview.subject).toBe(systemRow('ticket-created', 'en').subject);
    expect(preview.plannedHtml).toContain(TERRACOTTA.primary);
    expect(containsEmailPaletteTokens(preview.plannedHtml, STOCK_EMAIL_PALETTE)).toBe(false);
  });

  it('re-clones a row the branding tool wrote, dropping the previous palette', () => {
    const branded = brandedRow(100, 'ticket-created', 'en');

    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [branded],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
    })!;

    expect(preview.action).toBe('update');
    expect(preview.state).toBe('branded');
    expect(preview.currentHtml).toBe(branded.html_content);
    expect(preview.plannedHtml).toContain(FOREST.primary);
    expect(containsEmailPaletteTokens(preview.plannedHtml, TERRACOTTA)).toBe(false);
    expect(containsEmailPaletteTokens(preview.plannedHtml, STOCK_EMAIL_PALETTE)).toBe(false);
  });

  it('keeps the edits of a customized row and only recolors what is left', () => {
    const customized = customizedRow(200, 'ticket-created', 'en');

    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [customized],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
    })!;

    expect(preview.action).toBe('update');
    expect(preview.state).toBe('customized');
    // The tenant's own words and their own color survive untouched.
    expect(preview.plannedHtml).toContain('Open in our portal');
    expect(preview.plannedHtml).toContain('#101014');
    // Their subject is never rewritten by an apply.
    expect(preview.subject).toBe('A ticket needs you');
    // Everything still carrying a recognizable token moves to the new palette.
    expect(preview.plannedHtml).toContain(FOREST.primary);
    expect(containsEmailPaletteTokens(preview.plannedHtml, TERRACOTTA)).toBe(false);
  });

  it('previews a customized row as if it were ticked, whatever the dialog shows', () => {
    const customized = customizedRow(200, 'ticket-created', 'en');

    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [customized],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
    })!;

    expect(preview.action).not.toBe('skip');
    expect(preview.plannedHtml).not.toBe(preview.currentHtml);
  });

  it('previews an overwrite as the standard template in the new palette', () => {
    const customized = customizedRow(200, 'ticket-created', 'en');

    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [customized],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
      overwrite: true,
    })!;

    expect(preview.action).toBe('update');
    expect(preview.overwrite).toBe(true);
    // What the tenant is about to lose is visible in the preview, both ways.
    expect(preview.currentHtml).toContain('Open in our portal');
    expect(preview.plannedHtml).not.toContain('Open in our portal');
    expect(preview.plannedHtml).not.toContain('#101014');
    expect(preview.plannedHtml).toContain(FOREST.primary);
    expect(preview.subject).toBe(systemRow('ticket-created', 'en').subject);
  });

  it('offers an overwrite preview for a row with none of our colors left', () => {
    const redesign = {
      id: 400,
      name: 'ticket-created',
      language_code: 'en',
      subject: 'Ticket raised',
      html_content: '<html><head><style>body{background:#0b0b12}</style></head><body>{{ticket.title}}</body></html>',
      text_content: 'Ticket raised',
    };

    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [redesign],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
      overwrite: true,
    })!;

    expect(preview.action).toBe('update');
    expect(preview.state).toBe('no-stock-colors');
    expect(preview.plannedHtml).toContain(FOREST.primary);
  });

  it('marks a normal preview as not an overwrite', () => {
    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
    })!;

    expect(preview.overwrite).toBe(false);
  });

  it('shows the current HTML with a reason when there is nothing to replace', () => {
    const redesign = {
      id: 400,
      name: 'ticket-created',
      language_code: 'en',
      subject: 'Ticket raised',
      html_content: '<html><head><style>body{background:#0b0b12}</style></head><body>{{ticket.title}}</body></html>',
      text_content: 'Ticket raised',
    };

    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [redesign],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
    })!;

    expect(preview.action).toBe('skip');
    expect(preview.state).toBe('no-stock-colors');
    expect(preview.skipReason).toBe('nothing-to-replace');
    expect(preview.plannedHtml).toBe(redesign.html_content);
  });

  it('reports an unchanged row instead of pretending it would be rewritten', () => {
    const branded = brandedRow(100, 'ticket-created', 'en');

    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [branded],
      target: TERRACOTTA,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
    })!;

    expect(preview.action).toBe('skip');
    expect(preview.skipReason).toBe('unchanged');
    expect(preview.plannedHtml).toBe(preview.currentHtml);
  });

  it('previews one language without leaking the other', () => {
    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [brandedRow(100, 'ticket-created', 'en')],
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'fr',
    })!;

    expect(preview.language).toBe('fr');
    expect(preview.action).toBe('create');
    expect(preview.currentHtml).toBe(systemRow('ticket-created', 'fr').html_content);
  });

  it('runs the decorate pass the apply would run', () => {
    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
      decorate: (html) => decorateBrandedHtml(html, {
        logo: { variant: 'default', alt: 'Acme MSP' },
        hideAttribution: true,
      }),
    })!;

    expect(preview.plannedHtml).toContain(BRAND_LOGO_MARKER);
  });

  it('returns null for a template that ships in no such language', () => {
    expect(previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows: [],
      target: TERRACOTTA,
      name: 'ticket-created',
      language: 'de',
    })).toBeNull();
  });
});

describe('preview matches what an apply writes', () => {
  const decorate = (html: string) => decorateBrandedHtml(html, {
    logo: { variant: 'wide', alt: 'Acme MSP' },
  });

  const plannedFor = (tenantRows: any[], name: string, language: string) => {
    const plan = planEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: FOREST,
      appliedPalette: TERRACOTTA,
      scope: { names: NAMES, languages: ['en', 'fr'], includeCustomized: NAMES },
      decorate,
    });

    const insert = plan.inserts.find((entry) => entry.name === name && entry.language === language);
    const update = plan.updates.find((entry) => entry.name === name && entry.language === language);
    return insert?.html ?? update?.html ?? null;
  };

  it('shows byte for byte what the apply would store for a customized row', () => {
    const tenantRows = [customizedRow(200, 'ticket-created', 'en')];

    const preview = previewEmailBrandingApply({
      systemRows: SYSTEM_ROWS,
      tenantRows,
      target: FOREST,
      appliedPalette: TERRACOTTA,
      name: 'ticket-created',
      language: 'en',
      decorate,
    })!;

    expect(preview.plannedHtml).toBe(plannedFor(tenantRows, 'ticket-created', 'en'));
  });

  it('agrees with the apply for every state in one pass', () => {
    const tenantRows = [
      customizedRow(200, 'ticket-created', 'en'),
      brandedRow(201, 'ticket-closed', 'en'),
    ];

    for (const name of NAMES) {
      for (const language of ['en', 'fr']) {
        const preview = previewEmailBrandingApply({
          systemRows: SYSTEM_ROWS,
          tenantRows,
          target: FOREST,
          appliedPalette: TERRACOTTA,
          name,
          language,
          decorate,
        })!;

        const planned = plannedFor(tenantRows, name, language);
        if (planned === null) {
          expect(preview.action).toBe('skip');
          expect(preview.plannedHtml).toBe(preview.currentHtml);
        } else {
          expect(preview.plannedHtml).toBe(planned);
        }
      }
    }
  });
});
