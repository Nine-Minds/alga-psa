import { describe, expect, it } from 'vitest';
import { applyEmailPalette } from '../applyEmailPalette';
import { normalizeChangesBox } from '../changesBox';
import { classifyTenantTemplate } from '../classifyTenantTemplate';
import { resolveEmailPalette } from '../resolveEmailPalette';
import { STOCK_EMAIL_PALETTE } from '../stockPalette';
import { loadSystemTemplate } from './systemTemplateFixtures';

const TERRACOTTA = resolveEmailPalette({ primary: '#b4552f', secondary: '#3f4d8a' });

const AMBER = { bg: '#fff9e6', border: '#ffe4a3', label: '#92400e' };
const STOCK_INFO = {
  bg: STOCK_EMAIL_PALETTE.infoBoxBg,
  border: STOCK_EMAIL_PALETTE.infoBoxBorder,
  label: STOCK_EMAIL_PALETTE.dark,
};

/** The box exactly as the stock templates rendered it before the item loop. */
function legacyBox(label: string, root: 'ticket' | 'project', colors: typeof AMBER): string {
  return `<div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${colors.bg};border:1px solid ${colors.border};">
                  <div style="font-weight:600;color:${colors.label};margin-bottom:8px;">${label}</div>
                  <div style="color:#475467;line-height:1.5;">{{{${root}.changes}}}</div>
                </div>`;
}

const ITEMS_BOX = /<div style="margin:28px 0 16px 0;[\s\S]*?\{\{\/each\}\}\s*<\/div>/;

function systemRow(name: string) {
  const template = loadSystemTemplate(name);
  return { subject: template.subject, html_content: template.html };
}

/** A row the branding tool wrote from the template as it was before the item loop. */
function brandedLegacyRow(name: string, box: string) {
  const current = systemRow(name);
  expect(current.html_content).toMatch(ITEMS_BOX);
  return {
    subject: current.subject,
    html_content: applyEmailPalette(current.html_content.replace(ITEMS_BOX, box), STOCK_EMAIL_PALETTE, TERRACOTTA),
  };
}

describe('changes box', () => {
  it('paints the stock box from the palette, so an apply restyles it for the tenant', () => {
    const branded = applyEmailPalette(systemRow('ticket-updated').html_content, STOCK_EMAIL_PALETTE, TERRACOTTA);

    expect(branded).toContain('{{#each ticket.changeItems}}');
    expect(branded).not.toContain('{{{ticket.changes}}}');
    expect(branded).toContain(`color:${TERRACOTTA.dark};font-weight:600;word-break:break-word;">{{this.newValue}}`);
    expect(branded).toContain(`background:${TERRACOTTA.infoBoxBg};border:1px solid ${TERRACOTTA.infoBoxBorder};`);
    expect(branded).not.toMatch(/#fff9e6|#ffe4a3|#92400e/i);
  });

  it('collapses the old and new stock box to the same marker', () => {
    const current = systemRow('ticket-updated').html_content;
    const legacy = current.replace(ITEMS_BOX, legacyBox('Changes Made', 'ticket', AMBER));

    expect(normalizeChangesBox(current)).toContain('<!--changes-box:ticket:Changes Made-->');
    expect(normalizeChangesBox(legacy)).toBe(normalizeChangesBox(current));
  });

  it('keeps a ticket row the tool branded before the change classified as branded', () => {
    const tenantRow = brandedLegacyRow('ticket-updated', legacyBox('Changes Made', 'ticket', AMBER));

    expect(classifyTenantTemplate({ tenantRow, systemRow: systemRow('ticket-updated'), appliedPalette: TERRACOTTA }))
      .toEqual({ state: 'branded', differs: [] });
  });

  it('keeps a client ticket row the tool branded before the change classified as branded', () => {
    const tenantRow = brandedLegacyRow('ticket-updated-client', legacyBox('What Changed', 'ticket', AMBER));

    expect(
      classifyTenantTemplate({ tenantRow, systemRow: systemRow('ticket-updated-client'), appliedPalette: TERRACOTTA }),
    ).toEqual({ state: 'branded', differs: [] });
  });

  it('keeps a project row the tool branded before the change classified as branded', () => {
    // The project box was already palette-colored, so the old row carries the tenant's colors.
    const tenantRow = brandedLegacyRow('project-updated', legacyBox('Changes', 'project', STOCK_INFO));

    expect(classifyTenantTemplate({ tenantRow, systemRow: systemRow('project-updated'), appliedPalette: TERRACOTTA }))
      .toEqual({ state: 'branded', differs: [] });
  });

  it('still reports a reworded box heading as the tenant’s edit', () => {
    const tenantRow = brandedLegacyRow('ticket-updated', legacyBox('What we did', 'ticket', AMBER));

    const result = classifyTenantTemplate({
      tenantRow,
      systemRow: systemRow('ticket-updated'),
      appliedPalette: TERRACOTTA,
    });
    expect(result.state).toBe('customized');
    expect(result.differs).toContain('text');
  });

  it('leaves a restructured box alone', () => {
    const edited = systemRow('ticket-updated').html_content.replace(
      '{{this.label}}</div>',
      '{{this.label}}:</div>',
    );

    expect(normalizeChangesBox(edited)).not.toContain('<!--changes-box:');
  });
});
