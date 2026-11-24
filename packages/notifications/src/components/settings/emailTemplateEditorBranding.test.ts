import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  applyEmailPalette,
  classifyTenantTemplate,
  containsEmailPaletteTokens,
  resolveEmailPalette,
  STOCK_EMAIL_PALETTE,
} from '@alga-psa/email/branding';

const source = readFileSync(resolve(__dirname, 'EmailTemplates.tsx'), 'utf8');
const actionsSource = readFileSync(resolve(__dirname, '../../actions/notification-actions/notificationActions.ts'), 'utf8');

const TERRACOTTA = resolveEmailPalette({ primary: '#b4552f', secondary: '#3f4d8a' });

const SYSTEM_HTML = [
  '<body style="background:#f5f3ff">',
  '<td style="background:linear-gradient(135deg,#8A4DEA,#40CFF9);">New ticket</td>',
  '<a style="background:#8A4DEA">View Ticket</a>',
  '</body>',
].join('');

describe('editor palette integration', () => {
  it('offers the button only when a palette is saved', () => {
    expect(source).toContain('{brandingPalette && (');
    expect(source).toContain('id="apply-palette-to-template"');
    expect(source).toContain('onClick={applyPaletteToEditor}');
  });

  it('rewrites the editor draft client-side without calling an action', () => {
    const body = source.slice(source.indexOf('const applyPaletteToEditor'), source.indexOf('const handleSubmit'));

    expect(body).toContain('applyEmailPalette(previous.html_content');
    expect(body).toContain('[appliedPalette, STOCK_EMAIL_PALETTE]');
    expect(body).not.toContain('await ');
    expect(body).not.toContain('Action(');
  });

  it('replaces stock and previously applied tokens only', () => {
    const editorText = `${SYSTEM_HTML}<p>Our own wording</p>`;
    const rewritten = applyEmailPalette(editorText, [STOCK_EMAIL_PALETTE], TERRACOTTA);

    expect(rewritten).toContain('Our own wording');
    expect(rewritten).toContain(TERRACOTTA.primary);
    expect(containsEmailPaletteTokens(rewritten, STOCK_EMAIL_PALETTE)).toBe(false);
  });

  it('starts a clone from the branded HTML so the row classifies as branded', () => {
    // The clone action wears the palette itself (and stamps the row as derived), so the editor
    // no longer patches the copy afterwards, which would have cut that provenance.
    expect(actionsSource).toContain('applyEmailPalette(systemTemplate.html_content, STOCK_EMAIL_PALETTE, target)');
    expect(actionsSource).toContain('brand.palette.appliedPalette ?? resolveEmailPalette(brand.palette)');
    expect(source).not.toContain('updateTenantTemplateAction(result.id');

    const cloned = applyEmailPalette(SYSTEM_HTML, STOCK_EMAIL_PALETTE, TERRACOTTA);
    const classification = classifyTenantTemplate({
      tenantRow: { subject: 'New ticket', html_content: cloned },
      systemRow: { subject: 'New ticket', html_content: SYSTEM_HTML },
      appliedPalette: TERRACOTTA,
    });

    expect(classification.state).toBe('branded');
  });
});
