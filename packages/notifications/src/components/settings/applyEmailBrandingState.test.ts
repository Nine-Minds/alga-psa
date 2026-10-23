import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildApplyScope,
  countSelectedRows,
  defaultSelection,
  groupTemplatesByState,
  previewKey,
  previewLanguagesFor,
  shouldFetchPreview,
  summarizeApplyResult,
  templateStatusTone,
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
    // An overwrite can still reach that row, so it is counted separately.
    expect(groups['no-stock-colors'][0].allRows).toBe(1);
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

describe('forced overwrite', () => {
  const groups = groupTemplatesByState(templates, ['en', 'fr']);

  it('sends the forced names as overwrite alongside the ticked ones', () => {
    const scope = buildApplyScope(
      groups,
      new Set(['ticket-created', 'invoice-email']),
      ['en', 'fr'],
      new Set(['invoice-email']),
    );

    expect(scope.names.sort()).toEqual(['invoice-email', 'ticket-created']);
    expect(scope.overwrite).toEqual(['invoice-email']);
  });

  it('is the one way a no-stock-colors template enters the scope', () => {
    const scope = buildApplyScope(groups, new Set(), ['en'], new Set(['portal-invitation']));

    expect(scope.names).toEqual(['portal-invitation']);
    expect(scope.overwrite).toEqual(['portal-invitation']);
  });

  it('counts the rows an overwrite would reach, including the disabled ones', () => {
    expect(countSelectedRows(groups, new Set(), new Set(['portal-invitation']))).toBe(1);
    expect(countSelectedRows(groups, new Set(['invoice-email']), new Set(['invoice-email']))).toBe(2);
  });

  it('keys the preview cache apart from the palette-only run', () => {
    expect(previewKey('invoice-email', 'en', true)).not.toBe(previewKey('invoice-email', 'en'));
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

describe('preview language tabs', () => {
  it('offers the ticked languages the template actually ships in', () => {
    expect(previewLanguagesFor(templates, 'ticket-created', ['en', 'fr'])).toEqual(['en', 'fr']);
    expect(previewLanguagesFor(templates, 'ticket-created', ['fr'])).toEqual(['fr']);
  });

  it('never leaves the eye without a language to show', () => {
    expect(previewLanguagesFor(templates, 'portal-invitation', ['fr'])).toEqual(['en']);
  });

  it('keys the cache per name and language', () => {
    expect(previewKey('ticket-created', 'en')).not.toBe(previewKey('ticket-created', 'fr'));
  });
});

describe('shouldFetchPreview', () => {
  it('fetches the row that is on screen', () => {
    expect(shouldFetchPreview('a::en', 'a::en', new Set())).toBe(true);
  });

  it('drops a preview the tenant has already clicked past', () => {
    expect(shouldFetchPreview('a::en', 'b::en', new Set())).toBe(false);
  });

  it('drops one that arrived in the cache while it queued', () => {
    expect(shouldFetchPreview('a::en', 'a::en', new Set(['a::en']))).toBe(false);
  });

  it('drops everything once the preview is closed', () => {
    expect(shouldFetchPreview('a::en', null, new Set())).toBe(false);
  });
});

describe('templateStatusTone', () => {
  const entry = (differs: EmailBrandingTemplateStatus['differs']) =>
    groupTemplatesByState([row('invoice-email', 'en', 'customized', { differs })], ['en']).customized[0];

  it('marks a row no apply can reach as inert', () => {
    const inert = groupTemplatesByState(templates, ['en'])['no-stock-colors'][0];
    expect(templateStatusTone(inert, true)).toBe('inert');
  });

  it('calls out a row whose edits differ from the palette', () => {
    expect(templateStatusTone(entry(['colors']), false)).toBe('differs');
  });

  it('falls back to the category when nothing differs', () => {
    expect(templateStatusTone(entry([]), false)).toBe('category');
  });
});

describe('apply dialog markup', () => {
  it('renders as apply-email-branding-dialog with language checkboxes', () => {
    expect(dialogSource).toContain('id="apply-email-branding"');
    expect(dialogSource).toContain('id={`apply-branding-language-${code}`}');
  });

  it('puts its heading in the drag handle, not below it', () => {
    // A child DialogTitle leaves the handle empty and scrolls the heading away.
    expect(dialogSource).toContain("title={t('notifications.emailBranding.apply.title'");
    expect(dialogSource).not.toContain('<DialogTitle>');
  });

  it('disables the no-stock-colors group and hints why', () => {
    expect(dialogSource).toContain("const disabled = state === 'no-stock-colors'");
    // Disabled unless the tenant forced it: an overwrite is the one way in.
    expect(dialogSource).toContain('disabled={disabled && !overwrite.has(entry.name)}');
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

describe('per-template preview', () => {
  it('puts an eye on every row, disabled checkbox or not', () => {
    const button = dialogSource.slice(dialogSource.indexOf('id={`preview-branding-template-${entry.name}`}'));
    const props = button.slice(0, button.indexOf('</Button>'));

    expect(props).toContain('<Eye className="h-4 w-4" />');
    expect(props).toContain('onClick={() => openPreview(entry.name)}');
    // `disabled` is the no-stock-colors checkbox's business, never the eye's.
    expect(props).not.toContain('disabled');
  });

  it('renders the planned HTML and subject through EmailTemplatePreview', () => {
    expect(dialogSource).toContain('<Dialog\n        id="preview-branding-template"');
    expect(dialogSource).toContain('htmlContent={entry.preview.plannedHtml}');
    expect(dialogSource).toContain('subject={entry.preview.subject}');
  });

  it('explains the customized and skipped cases in words', () => {
    expect(dialogSource).toContain('apply.preview.captions.customized');
    expect(dialogSource).toContain('apply.preview.captions.skipped');
    expect(dialogSource).toContain('reason: skipReason(preview.skipReason');
  });

  it('offers an overwrite on the groups an apply would otherwise not reach', () => {
    expect(dialogSource).toContain('const overwritable = OVERWRITABLE_STATES.includes(state)');
    expect(dialogSource).toContain('id={`overwrite-branding-template-${entry.name}`}');
    expect(dialogSource).toContain('apply.overwriteHint');
    expect(dialogSource).toContain('apply.preview.captions.overwrite');
    // Forcing a row implies selecting it, and the scope carries both.
    expect(dialogSource).toContain('buildApplyScope(groups, selected, languages, overwrite)');
  });

  it('fetches lazily, once per name and language', () => {
    expect(dialogSource).toContain('previewEmailBrandingApplyAction({ name, language, overwrite: forced })');
    expect(dialogSource).toContain('if (requestedPreviews.current.has(key)) return;');
    expect(dialogSource).toContain("previewLanguagesFor(status.templates, name, languages)[0]");
  });

  it('asks for one preview at a time, and only for the row on screen', () => {
    // A run down the eyes queued a server action per click, each one holding a
    // database connection; enough of them and the session check behind the next
    // request times out, which signs the tenant out.
    expect(dialogSource).toContain('const previewQueue = useRef(createSerialMutationQueue());');
    expect(dialogSource).toContain('await previewQueue.current.enqueue(async () => {');
    expect(dialogSource).toContain('shouldFetchPreview(key, visiblePreview.current, requestedPreviews.current)');
    // Closing the preview retires the target, so nothing queued is fetched.
    expect(dialogSource).toContain('visiblePreview.current = null;');
    expect(dialogSource).toContain('onClose={closePreview}');
  });

  it('states each row in a pill, never as text beside the overwrite box', () => {
    expect(dialogSource).toContain('const tone = templateStatusTone(entry, disabled);');
    expect(dialogSource).toContain('id={`status-branding-template-${entry.name}`}');
    expect(dialogSource).toContain('variant={STATUS_TONE_VARIANTS[tone]}');
    // An empty category would otherwise render as a bare dot.
    expect(dialogSource).toContain('{statusLabel && (');
  });

  it('shows a loading and an error state instead of an empty frame', () => {
    expect(dialogSource).toContain('id="preview-branding-template-loading"');
    expect(dialogSource).toContain('id="preview-branding-template-error"');
  });

  it('drops the cache when the dialog reopens on a changed palette', () => {
    expect(dialogSource).toContain('setPreviewCache({});');
    expect(dialogSource).toContain('requestedPreviews.current = new Set();');
  });
});
