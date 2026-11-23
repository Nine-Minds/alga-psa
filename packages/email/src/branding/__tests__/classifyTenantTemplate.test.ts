import { describe, expect, it } from 'vitest';
import { applyEmailPalette } from '../applyEmailPalette';
import { decorateBrandedHtml } from '../brandAssets';
import { stripGradientFallback } from '../gradientFallback';
import { classifyTenantTemplate } from '../classifyTenantTemplate';
import { resolveEmailPalette } from '../resolveEmailPalette';
import { STOCK_EMAIL_PALETTE } from '../stockPalette';
import { loadSystemTemplate } from './systemTemplateFixtures';

const TERRACOTTA = resolveEmailPalette({ primary: '#b4552f', secondary: '#3f4d8a' });

const systemRow = (() => {
  const template = loadSystemTemplate('ticket-created');
  return { subject: template.subject, html_content: template.html };
})();

const brandedRow = {
  subject: systemRow.subject,
  html_content: applyEmailPalette(systemRow.html_content, STOCK_EMAIL_PALETTE, TERRACOTTA),
};

/** The shape a full redesign takes: <style> blocks, none of our tokens left. */
const darkRedesign = {
  subject: systemRow.subject,
  html_content: [
    '<!DOCTYPE html><html><head><style>',
    'body{background:#0b0b12;color:#e6e6f0}.card{background:#161622;border:1px solid #2a2a3d}',
    '</style></head><body><div class="card">{{ticket.title}}</div></body></html>',
  ].join(''),
};

describe('classifyTenantTemplate', () => {
  it('classifies a missing tenant row as system', () => {
    expect(classifyTenantTemplate({ tenantRow: null, systemRow })).toEqual({ state: 'system', differs: [] });
  });

  it('classifies a row the tool wrote as branded', () => {
    expect(classifyTenantTemplate({ tenantRow: brandedRow, systemRow, appliedPalette: TERRACOTTA }))
      .toEqual({ state: 'branded', differs: [] });
  });

  it('classifies a branded row written before the header carried the flat fallback as branded', () => {
    // Rows in tenant_email_templates predate the bgcolor/background-color
    // fallback; the corrected system template must not turn them "customized".
    const legacyBranded = {
      subject: brandedRow.subject,
      html_content: stripGradientFallback(brandedRow.html_content),
    };
    expect(legacyBranded.html_content).not.toBe(brandedRow.html_content);

    expect(classifyTenantTemplate({ tenantRow: legacyBranded, systemRow, appliedPalette: TERRACOTTA }))
      .toEqual({ state: 'branded', differs: [] });
  });

  it('classifies an untouched clone as branded before any palette is applied', () => {
    expect(classifyTenantTemplate({ tenantRow: { ...systemRow }, systemRow }))
      .toEqual({ state: 'branded', differs: [] });
  });

  it('classifies a branded row with an edited subject as customized differing on subject', () => {
    const result = classifyTenantTemplate({
      tenantRow: { ...brandedRow, subject: 'Ticket raised: {{ticket.title}}' },
      systemRow,
      appliedPalette: TERRACOTTA,
    });

    expect(result.state).toBe('customized');
    expect(result.differs).toEqual(['subject']);
  });

  it('classifies a hand color swap as customized differing on colors', () => {
    const result = classifyTenantTemplate({
      tenantRow: {
        subject: systemRow.subject,
        html_content: systemRow.html_content.replace(STOCK_EMAIL_PALETTE.dark, '#204d2f'),
      },
      systemRow,
    });

    expect(result.state).toBe('customized');
    expect(result.differs).toEqual(['colors']);
  });

  it('classifies a copy edit as customized differing on text', () => {
    const result = classifyTenantTemplate({
      tenantRow: {
        subject: systemRow.subject,
        html_content: systemRow.html_content.replace('View Ticket', 'Open in our portal'),
      },
      systemRow,
    });

    expect(result.state).toBe('customized');
    expect(result.differs).toEqual(['text']);
  });

  it('classifies a full redesign with no recognizable tokens as no-stock-colors', () => {
    expect(classifyTenantTemplate({ tenantRow: darkRedesign, systemRow, appliedPalette: TERRACOTTA }).state)
      .toBe('no-stock-colors');
  });

  it('still recognizes a previously applied palette after the tenant edits copy', () => {
    const result = classifyTenantTemplate({
      tenantRow: {
        subject: systemRow.subject,
        html_content: brandedRow.html_content.replace('View Ticket', 'Open in our portal'),
      },
      systemRow,
      appliedPalette: TERRACOTTA,
    });

    expect(result.state).toBe('customized');
    expect(result.differs).toEqual(['text']);
  });
});

describe('classifyTenantTemplate with enterprise brand assets', () => {
  const logo = { variant: 'default' as const, alt: 'Acme' };

  it('recognizes a row it wrote with a logo and no attribution as branded', () => {
    const decorated = decorateBrandedHtml(brandedRow.html_content, { logo, hideAttribution: true });

    expect(classifyTenantTemplate({
      tenantRow: { ...brandedRow, html_content: decorated },
      systemRow,
      appliedPalette: TERRACOTTA,
    })).toEqual({ state: 'branded', differs: [] });
  });

  /**
   * What the old strip wrote: "Powered by AlgaPSA &middot;" gone, the slogan
   * left alone in the footer row. Those rows sit in tenant_email_templates
   * today (alga-2026-0003353) and must stay ours, or the corrected strip would
   * never reach them.
   */
  const withOrphanedSlogan = (html: string, slogan: string) =>
    html.replace(new RegExp(`Powered by AlgaPSA\\s*&middot;\\s*(?=${slogan})`), '');

  it.each([
    ['en', 'ticket-created', 'Keeping teams aligned'],
    ['de', 'ticket-created', 'Teams auf Kurs halten'],
  ])('recognizes a %s row the old strip left on the bare slogan as branded', (language, name, slogan) => {
    const template = loadSystemTemplate(name, language);
    const branded = decorateBrandedHtml(
      applyEmailPalette(template.html, STOCK_EMAIL_PALETTE, TERRACOTTA),
      { logo },
    );
    const stored = withOrphanedSlogan(branded, slogan);

    expect(stored).not.toBe(branded);
    expect(stored).toContain(slogan);
    expect(stored).not.toContain('Powered by AlgaPSA');

    expect(classifyTenantTemplate({
      tenantRow: { subject: template.subject, html_content: stored },
      systemRow: { subject: template.subject, html_content: template.html },
      appliedPalette: TERRACOTTA,
    })).toEqual({ state: 'branded', differs: [] });
  });

  it('recognizes a row the old strip left on an empty footer band as branded', () => {
    // Templates whose stock footer is the attribution alone kept an empty
    // coloured band instead of an orphaned slogan. Same leftover, same rule.
    const template = loadSystemTemplate('project-status-update', 'en');
    const branded = decorateBrandedHtml(
      applyEmailPalette(template.html, STOCK_EMAIL_PALETTE, TERRACOTTA),
      { logo },
    );
    const stored = branded.replace('Powered by AlgaPSA', '');

    expect(stored).not.toBe(branded);
    expect(stored).toMatch(/<tr[^>]*>\s*<td[^>]*>\s*<\/td>\s*<\/tr>/);

    expect(classifyTenantTemplate({
      tenantRow: { subject: template.subject, html_content: stored },
      systemRow: { subject: template.subject, html_content: template.html },
      appliedPalette: TERRACOTTA,
    })).toEqual({ state: 'branded', differs: [] });
  });

  it('still calls a copy edit on such a row customized', () => {
    const decorated = decorateBrandedHtml(brandedRow.html_content, { logo, hideAttribution: true })
      .replace('View Ticket', 'Open in our portal');

    const result = classifyTenantTemplate({
      tenantRow: { ...brandedRow, html_content: decorated },
      systemRow,
      appliedPalette: TERRACOTTA,
    });

    expect(result.state).toBe('customized');
    expect(result.differs).toEqual(['text']);
  });
});
