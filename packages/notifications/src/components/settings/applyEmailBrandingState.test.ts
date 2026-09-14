import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildApplyScope,
  countSelectedRows,
  defaultSelection,
  groupTemplatesByState,
  summarizeApplyResult,
} from './applyEmailBrandingState';
import type { EmailBrandingTemplateStatus } from '../../lib/emailBranding';

const dialogSource = readFileSync(resolve(__dirname, 'ApplyEmailBrandingDialog.tsx'), 'utf8');

const row = (
  name: string,
  language: string,
  state: EmailBrandingTemplateStatus['state'],
  extra: Partial<EmailBrandingTemplateStatus> = {},
): EmailBrandingTemplateStatus => ({
  name,
  language,
  category: 'Tickets',
  systemTemplateId: 1,
  state,
  differs: [],
  isNew: false,
  ...extra,
});

const templates = [
  row('ticket-created', 'en', 'system'),
  row('ticket-created', 'fr', 'system'),
  row('ticket-closed', 'en', 'branded'),
  row('ticket-closed', 'fr', 'system'),
  row('invoice-email', 'en', 'customized', { differs: ['text'] }),
  row('invoice-email', 'fr', 'branded'),
  row('portal-invitation', 'en', 'no-stock-colors'),
];

describe('groupTemplatesByState', () => {
  it('files each name under its most conservative state', () => {
    const groups = groupTemplatesByState(templates, ['en', 'fr']);

    expect(groups.system.map((entry) => entry.name)).toEqual(['ticket-created']);
    expect(groups.branded.map((entry) => entry.name)).toEqual(['ticket-closed']);
    expect(groups.customized.map((entry) => entry.name)).toEqual(['invoice-email']);
    expect(groups['no-stock-colors'].map((entry) => entry.name)).toEqual(['portal-invitation']);
  });

  it('carries the differs hint of the customized rows', () => {
    const groups = groupTemplatesByState(templates, ['en', 'fr']);

    expect(groups.customized[0].differs).toEqual(['text']);
  });

  it('regroups when a language is dropped from the selection', () => {
    const groups = groupTemplatesByState(templates, ['fr']);

    expect(groups.system.map((entry) => entry.name).sort()).toEqual(['ticket-closed', 'ticket-created']);
    expect(groups.branded.map((entry) => entry.name)).toEqual(['invoice-email']);
    expect(groups.customized).toEqual([]);
  });

  it('counts only the rows that could be written', () => {
    const groups = groupTemplatesByState(templates, ['en', 'fr']);

    expect(groups.system[0].rows).toBe(2);
    expect(groups['no-stock-colors'][0].rows).toBe(0);
  });
});

describe('selection', () => {
  const groups = groupTemplatesByState(templates, ['en', 'fr']);

  it('preselects system and branded templates only', () => {
    expect([...defaultSelection(groups)].sort()).toEqual(['ticket-closed', 'ticket-created']);
  });

  it('counts the rows a confirm would write', () => {
    expect(countSelectedRows(groups, defaultSelection(groups))).toBe(4);
  });

  it('drops the count when a group is deselected', () => {
    expect(countSelectedRows(groups, new Set(['ticket-closed']))).toBe(2);
    expect(countSelectedRows(groups, new Set())).toBe(0);
  });

  it('never counts a no-stock-colors template', () => {
    expect(countSelectedRows(groups, new Set(['portal-invitation']))).toBe(0);
  });

  it('sends ticked customized names as includeCustomized', () => {
    const scope = buildApplyScope(groups, new Set(['ticket-created', 'invoice-email']), ['en', 'fr']);

    expect(scope.names.sort()).toEqual(['invoice-email', 'ticket-created']);
    expect(scope.includeCustomized).toEqual(['invoice-email']);
    expect(scope.languages).toEqual(['en', 'fr']);
  });

  it('keeps a no-stock-colors template out of the scope entirely', () => {
    expect(buildApplyScope(groups, new Set(['portal-invitation']), ['en']).names).toEqual([]);
  });
});

describe('summarizeApplyResult', () => {
  it('counts written, skipped and failed rows', () => {
    const summary = summarizeApplyResult({
      written: [{ name: 'ticket-created', language: 'en', action: 'created' }],
      skipped: [{ name: 'invoice-email', language: 'en', state: 'customized', reason: 'customized' }],
      failed: [{ name: 'ticket-closed', language: 'fr', error: 'deadlock detected' }],
      appliedAt: '2026-09-09T12:00:00.000Z',
    });

    expect(summary).toEqual({ written: 1, skipped: 1, failed: 1 });
  });
});

describe('apply dialog markup', () => {
  it('renders as apply-email-branding-dialog with language checkboxes', () => {
    expect(dialogSource).toContain('<Dialog id="apply-email-branding"');
    expect(dialogSource).toContain('id={`apply-branding-language-${code}`}');
  });

  it('disables the no-stock-colors group and hints why', () => {
    expect(dialogSource).toContain("const disabled = state === 'no-stock-colors'");
    expect(dialogSource).toContain('disabled={disabled}');
    expect(dialogSource).toContain("groups.no-stock-colors.action");
  });

  it('offers select all and none per group and a live count on confirm', () => {
    expect(dialogSource).toContain('id={`apply-branding-select-all-${state}`}');
    expect(dialogSource).toContain('id={`apply-branding-select-none-${state}`}');
    expect(dialogSource).toContain('id="confirm-apply-email-branding"');
    expect(dialogSource).toContain('count: selectedRows');
  });

  it('replaces the table with a summary carrying per-row reasons', () => {
    expect(dialogSource).toContain('id="apply-email-branding-summary"');
    expect(dialogSource).toContain('id="apply-email-branding-failures"');
    expect(dialogSource).toContain('summary ? (');
  });

  it('refreshes the templates list after applying', () => {
    expect(dialogSource).toContain('await onApplied()');
  });
});
