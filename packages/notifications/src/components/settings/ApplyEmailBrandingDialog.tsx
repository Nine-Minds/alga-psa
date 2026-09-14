'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@alga-psa/ui/components/Button";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { Dialog, DialogContent, DialogTitle } from "@alga-psa/ui/components/Dialog";
import { Label } from "@alga-psa/ui/components/Label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alga-psa/ui/components/Tabs";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { getErrorMessage } from "@alga-psa/ui/lib/errorHandling";
import type { TenantTemplateState } from "@alga-psa/email/branding";
import { applyEmailBrandingAction, previewEmailBrandingApplyAction } from "../../actions";
import type {
  EmailBrandingApplyResult,
  EmailBrandingPreviewResult,
  EmailBrandingStatus,
} from "../../lib/emailBranding";
import { EmailTemplatePreview } from "./EmailTemplatePreview";
import {
  OVERWRITABLE_STATES,
  TEMPLATE_GROUP_ORDER,
  buildApplyScope,
  countSelectedRows,
  defaultSelection,
  groupTemplatesByState,
  previewKey,
  previewLanguagesFor,
  summarizeApplyResult,
  type PreviewCache,
  type PreviewCacheEntry,
} from "./applyEmailBrandingState";

const DIFFERS_FALLBACKS: Record<string, string> = {
  colors: 'colors',
  text: 'text',
  subject: 'subject',
};

/**
 * "Apply to templates": pick the languages and the templates, see exactly how
 * many rows will be written, then read the per-row result.
 */
export function ApplyEmailBrandingDialog({
  isOpen,
  onClose,
  status,
  preselectedNames,
  onApplied,
}: {
  isOpen: boolean;
  onClose: () => void;
  status: EmailBrandingStatus;
  /** Set by the new-template banner so only those arrive ticked. */
  preselectedNames?: string[];
  onApplied: () => void | Promise<void>;
}) {
  const { t } = useTranslation('msp/settings');

  const groupTitle = (state: TenantTemplateState) => {
    switch (state) {
      case 'system': return t('notifications.emailBranding.apply.groups.system.title', 'Not customized');
      case 'branded': return t('notifications.emailBranding.apply.groups.branded.title', 'Branded by you');
      case 'customized': return t('notifications.emailBranding.apply.groups.customized.title', 'Customized');
      default: return t('notifications.emailBranding.apply.groups.no-stock-colors.title', 'No stock colors');
    }
  };

  const groupAction = (state: TenantTemplateState) => {
    switch (state) {
      case 'system': return t('notifications.emailBranding.apply.groups.system.action', 'Create branded copy');
      case 'branded': return t('notifications.emailBranding.apply.groups.branded.action', 'Update colors');
      case 'customized': return t('notifications.emailBranding.apply.groups.customized.action', 'Replace remaining stock colors only');
      default: return t('notifications.emailBranding.apply.groups.no-stock-colors.action', 'Nothing to replace');
    }
  };

  const skipReason = (reason: string) => {
    switch (reason) {
      case 'customized': return t('notifications.emailBranding.apply.skipReasons.customized', 'Customized — not selected');
      case 'nothing-to-replace': return t('notifications.emailBranding.apply.skipReasons.nothing-to-replace', 'Nothing to replace');
      default: return t('notifications.emailBranding.apply.skipReasons.unchanged', 'Already up to date');
    }
  };

  const [languages, setLanguages] = useState<string[]>(status.languages.length > 0 ? status.languages : ['en']);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Names to rebuild from the standard template, tenant edits and all. */
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<EmailBrandingApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [previewLanguage, setPreviewLanguage] = useState<string>('');
  const [previewCache, setPreviewCache] = useState<PreviewCache>({});
  /** Keys already requested, so re-rendering never fires a second round trip. */
  const requestedPreviews = useRef<Set<string>>(new Set());

  const groups = useMemo(() => groupTemplatesByState(status.templates, languages), [status.templates, languages]);

  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setError(null);
    setLanguages(status.languages.length > 0 ? status.languages : ['en']);
    setOverwrite(new Set());
    setPreviewName(null);
    // The palette may have changed since the last time this opened.
    setPreviewCache({});
    requestedPreviews.current = new Set();
  }, [isOpen, status.languages]);

  const loadPreview = useCallback(async (name: string, language: string, forced: boolean) => {
    const key = previewKey(name, language, forced);
    if (requestedPreviews.current.has(key)) return;
    requestedPreviews.current.add(key);
    setPreviewCache((current) => ({ ...current, [key]: { status: 'loading' } }));

    try {
      const preview = await previewEmailBrandingApplyAction({ name, language, overwrite: forced });
      setPreviewCache((current) => ({ ...current, [key]: { status: 'ready', preview } }));
    } catch (previewError) {
      // Dropped from the requested set so reopening the eye retries.
      requestedPreviews.current.delete(key);
      setPreviewCache((current) => ({
        ...current,
        [key]: { status: 'error', error: getErrorMessage(previewError) },
      }));
    }
  }, []);

  const openPreview = (name: string) => {
    const language = previewLanguagesFor(status.templates, name, languages)[0];
    if (!language) return;
    setPreviewName(name);
    setPreviewLanguage(language);
    loadPreview(name, language, overwrite.has(name));
  };

  const selectPreviewLanguage = (language: string) => {
    setPreviewLanguage(language);
    if (previewName) loadPreview(previewName, language, overwrite.has(previewName));
  };

  useEffect(() => {
    if (!isOpen) return;
    setSelected(preselectedNames ? new Set(preselectedNames) : defaultSelection(groups));
    // Recomputed whenever the language set changes the grouping.
  }, [isOpen, groups, preselectedNames]);

  const selectedRows = countSelectedRows(groups, selected, overwrite);

  const toggleLanguage = (code: string) => {
    setLanguages((current) => (current.includes(code)
      ? current.filter((language) => language !== code)
      : [...current, code].sort()));
  };

  const toggleTemplate = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    if (selected.has(name)) {
      setOverwrite((current) => {
        if (!current.has(name)) return current;
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    }
  };

  /** Ticking "overwrite" is a stronger yes than the checkbox, so it implies one. */
  const toggleOverwrite = (name: string) => {
    setOverwrite((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setSelected((current) => {
      if (overwrite.has(name)) return current;
      const next = new Set(current);
      next.add(name);
      return next;
    });
  };

  const setGroupSelection = (state: TenantTemplateState, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const entry of groups[state]) {
        if (checked) next.add(entry.name);
        else next.delete(entry.name);
      }
      return next;
    });
    // Unticking a group cannot leave a forced rebuild behind it.
    if (!checked) {
      setOverwrite((current) => {
        const next = new Set(current);
        for (const entry of groups[state]) next.delete(entry.name);
        return next;
      });
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const applied = await applyEmailBrandingAction(buildApplyScope(groups, selected, languages, overwrite));
      setResult(applied);
      await onApplied();
    } catch (applyError) {
      setError(getErrorMessage(applyError));
    } finally {
      setApplying(false);
    }
  };

  const summary = result ? summarizeApplyResult(result) : null;

  const previewTabs = previewName ? previewLanguagesFor(status.templates, previewName, languages) : [];
  const previewEntry = previewName
    ? previewCache[previewKey(previewName, previewLanguage, overwrite.has(previewName))]
    : undefined;

  /** Says, in words, what the rendered HTML below it is: a clone, a recolor, or nothing. */
  const previewCaption = (preview: EmailBrandingPreviewResult) => {
    if (preview.overwrite && preview.action !== 'skip') {
      return t(
        'notifications.emailBranding.apply.preview.captions.overwrite',
        'Your edits to this template will be discarded. It will be rebuilt from the standard template in your palette.',
      );
    }
    if (preview.action === 'skip') {
      return t('notifications.emailBranding.apply.preview.captions.skipped', {
        defaultValue: 'Nothing will be written — {{reason}}. This is the template as it stands today.',
        reason: skipReason(preview.skipReason ?? 'unchanged'),
      });
    }
    if (preview.state === 'customized') {
      return t(
        'notifications.emailBranding.apply.preview.captions.customized',
        'Your edits are kept word for word. Only the stock colors still left in this template are replaced.',
      );
    }
    if (preview.action === 'create') {
      return t(
        'notifications.emailBranding.apply.preview.captions.create',
        'A branded copy of the standard template will be created for you.',
      );
    }
    return t(
      'notifications.emailBranding.apply.preview.captions.update',
      'Your branded copy will be rebuilt from the standard template with the saved palette.',
    );
  };

  const previewBody = (entry: PreviewCacheEntry | undefined) => {
    if (!entry || entry.status === 'loading') {
      return (
        <p id="preview-branding-template-loading" className="text-sm text-gray-500">
          {t('notifications.emailBranding.apply.preview.loading', 'Building the preview...')}
        </p>
      );
    }

    if (entry.status === 'error') {
      return (
        <div
          id="preview-branding-template-error"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {entry.error}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p id="preview-branding-template-caption" className="text-sm text-gray-600">
          {previewCaption(entry.preview)}
        </p>
        <EmailTemplatePreview
          id="preview-branding-template-frame"
          htmlContent={entry.preview.plannedHtml}
          templateName={entry.preview.name}
          subject={entry.preview.subject}
        />
      </div>
    );
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button id="close-apply-email-branding" type="button" variant="outline" onClick={onClose}>
        {result
          ? t('notifications.emailBranding.actions.done', 'Done')
          : t('notifications.emailBranding.actions.cancel', 'Cancel')}
      </Button>
      {!result && (
        <Button
          id="confirm-apply-email-branding"
          type="button"
          disabled={applying || selectedRows === 0 || languages.length === 0}
          onClick={handleApply}
        >
          {applying
            ? t('notifications.emailBranding.actions.applying', 'Applying...')
            : t('notifications.emailBranding.actions.applyCount', {
              defaultValue: 'Apply to {{count}} templates',
              count: selectedRows,
            })}
        </Button>
      )}
    </div>
  );

  return (
    // Dialog appends "-dialog" to the id it renders: apply-email-branding-dialog.
    <Dialog id="apply-email-branding" isOpen={isOpen} onClose={onClose} className="max-w-4xl" footer={footer}>
      <DialogTitle>{t('notifications.emailBranding.apply.title', 'Apply branding to templates')}</DialogTitle>

      <DialogContent className="space-y-4 px-6">
        {error && (
          <div id="apply-email-branding-error" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {summary ? (
          <div id="apply-email-branding-summary" className="space-y-3">
            <p className="text-sm">
              {t('notifications.emailBranding.apply.summary', {
                defaultValue: '{{written}} branded, {{skipped}} skipped, {{failed}} failed',
                written: summary.written,
                skipped: summary.skipped,
                failed: summary.failed,
              })}
            </p>

            {result!.skipped.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-gray-600">
                {result!.skipped.map((skip) => (
                  <li key={`${skip.name}-${skip.language}-${skip.reason}`}>
                    {skip.name} ({skip.language}) — {skipReason(skip.reason)}
                  </li>
                ))}
              </ul>
            )}

            {result!.failed.length > 0 && (
              <ul id="apply-email-branding-failures" className="max-h-40 space-y-1 overflow-y-auto text-xs text-red-700">
                {result!.failed.map((failure) => (
                  <li key={`${failure.name}-${failure.language}`}>
                    {failure.name} ({failure.language}) — {failure.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div>
              <Label>{t('notifications.emailBranding.apply.languages', 'Languages')}</Label>
              <div className="mt-2 flex flex-wrap gap-3">
                {status.availableLanguages.map((code) => (
                  <Checkbox
                    key={code}
                    id={`apply-branding-language-${code}`}
                    label={t(`notifications.emailTemplatesUi.languages.${code}`, code.toUpperCase())}
                    checked={languages.includes(code)}
                    onChange={() => toggleLanguage(code)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {TEMPLATE_GROUP_ORDER.map((state) => {
                const entries = groups[state];
                if (entries.length === 0) return null;
                const disabled = state === 'no-stock-colors';
                // Only these two groups keep tenant edits an apply cannot repaint.
                const overwritable = OVERWRITABLE_STATES.includes(state);

                return (
                  <div key={state} className="rounded border">
                    <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-2">
                      <div>
                        <span className="text-sm font-medium">{groupTitle(state)}</span>
                        <span className="ml-2 text-xs text-gray-500">{groupAction(state)}</span>
                        {/* Stated in words, not only in a tooltip: it discards edits. */}
                        {overwritable && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            {t(
                              'notifications.emailBranding.apply.overwriteHint',
                              'Overwrite rebuilds a template from the standard one in your palette and discards your edits.',
                            )}
                          </p>
                        )}
                      </div>
                      {!disabled && (
                        <div className="flex gap-2">
                          <Button
                            id={`apply-branding-select-all-${state}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => setGroupSelection(state, true)}
                          >
                            {t('notifications.emailBranding.apply.selectAll', 'Select all')}
                          </Button>
                          <Button
                            id={`apply-branding-select-none-${state}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => setGroupSelection(state, false)}
                          >
                            {t('notifications.emailBranding.apply.selectNone', 'Select none')}
                          </Button>
                        </div>
                      )}
                    </div>

                    <ul className="max-h-52 divide-y overflow-y-auto">
                      {entries.map((entry) => (
                        <li key={entry.name} className="flex items-center justify-between gap-2 px-3 py-2">
                          <Checkbox
                            id={`apply-branding-template-${entry.name}`}
                            label={entry.name}
                            checked={overwrite.has(entry.name) || (!disabled && selected.has(entry.name))}
                            disabled={disabled && !overwrite.has(entry.name)}
                            onChange={() => toggleTemplate(entry.name)}
                          />
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-gray-500">
                              {disabled
                                ? groupAction('no-stock-colors')
                                : entry.differs.length > 0
                                  ? t('notifications.emailBranding.apply.differs', {
                                    defaultValue: 'Differs in {{parts}}',
                                    parts: entry.differs
                                      .map((part) => t(`notifications.emailBranding.apply.differsParts.${part}`, DIFFERS_FALLBACKS[part]))
                                      .join(', '),
                                  })
                                  : entry.category}
                            </span>
                            {/* The only way to repaint colors the tenant chose
                                themselves: rebuild the row and lose their edits. */}
                            {overwritable && (
                              <Checkbox
                                id={`overwrite-branding-template-${entry.name}`}
                                label={t('notifications.emailBranding.apply.overwrite', 'Overwrite')}
                                title={t(
                                  'notifications.emailBranding.apply.overwriteHint',
                                  'Overwrite rebuilds a template from the standard one in your palette and discards your edits.',
                                )}
                                checked={overwrite.has(entry.name)}
                                onChange={() => toggleOverwrite(entry.name)}
                                size="sm"
                              />
                            )}
                            {/* Previewable even when the checkbox is not: seeing why a
                                template will be left alone is the point. */}
                            <Button
                              id={`preview-branding-template-${entry.name}`}
                              variant="ghost"
                              size="sm"
                              title={t('notifications.emailBranding.apply.preview.open', 'Preview the result')}
                              aria-label={t('notifications.emailBranding.apply.preview.open', 'Preview the result')}
                              onClick={() => openPreview(entry.name)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>

      {/* Nested inside the apply dialog, so InsideDialogContext renders it
          portal-less and the focus trap stays with the parent. */}
      <Dialog
        id="preview-branding-template"
        isOpen={!!previewName}
        onClose={() => setPreviewName(null)}
        className="max-w-3xl"
        // The title lives in the prop, not a DialogTitle: a nested dialog renders
        // inside the parent's Radix root, which already owns the accessible title.
        title={t('notifications.emailBranding.apply.preview.title', {
          defaultValue: 'Preview: {{name}}',
          name: previewName ?? '',
        })}
        footer={(
          <div className="flex justify-end">
            <Button id="close-preview-branding-template" type="button" variant="outline" onClick={() => setPreviewName(null)}>
              {t('notifications.emailBranding.actions.done', 'Done')}
            </Button>
          </div>
        )}
      >
        <DialogContent className="space-y-3">
          {previewTabs.length > 1 ? (
            <Tabs value={previewLanguage} onValueChange={selectPreviewLanguage}>
              <TabsList>
                {previewTabs.map((code) => (
                  <TabsTrigger key={code} id={`preview-branding-language-${code}`} value={code}>
                    {t(`notifications.emailTemplatesUi.languages.${code}`, code.toUpperCase())}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={previewLanguage} className="pt-3">
                {previewBody(previewEntry)}
              </TabsContent>
            </Tabs>
          ) : (
            previewBody(previewEntry)
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
