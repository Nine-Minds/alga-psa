import { describe, expect, it } from 'vitest';
import { applyEmailPalette } from '../applyEmailPalette';
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
