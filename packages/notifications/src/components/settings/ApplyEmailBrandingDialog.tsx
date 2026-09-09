'use client';

import { useEffect, useMemo, useState } from "react";
import { Button } from "@alga-psa/ui/components/Button";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { Dialog, DialogContent, DialogTitle } from "@alga-psa/ui/components/Dialog";
import { Label } from "@alga-psa/ui/components/Label";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { getErrorMessage } from "@alga-psa/ui/lib/errorHandling";
import type { TenantTemplateState } from "@alga-psa/email/branding";
import { applyEmailBrandingAction } from "../../actions";
import type { EmailBrandingApplyResult, EmailBrandingStatus } from "../../lib/emailBranding";
import {
  TEMPLATE_GROUP_ORDER,
  buildApplyScope,
  countSelectedRows,
  defaultSelection,
  groupTemplatesByState,
  summarizeApplyResult,
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
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<EmailBrandingApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupTemplatesByState(status.templates, languages), [status.templates, languages]);

  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setError(null);
    setLanguages(status.languages.length > 0 ? status.languages : ['en']);
  }, [isOpen, status.languages]);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(preselectedNames ? new Set(preselectedNames) : defaultSelection(groups));
    // Recomputed whenever the language set changes the grouping.
  }, [isOpen, groups, preselectedNames]);

  const selectedRows = countSelectedRows(groups, selected);

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
  };

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const applied = await applyEmailBrandingAction(buildApplyScope(groups, selected, languages));
      setResult(applied);
      await onApplied();
    } catch (applyError) {
      setError(getErrorMessage(applyError));
    } finally {
      setApplying(false);
    }
  };

  const summary = result ? summarizeApplyResult(result) : null;

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

                return (
                  <div key={state} className="rounded border">
                    <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-2">
                      <div>
                        <span className="text-sm font-medium">{groupTitle(state)}</span>
                        <span className="ml-2 text-xs text-gray-500">{groupAction(state)}</span>
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
                        <li key={entry.name} className="flex items-center justify-between px-3 py-2">
                          <Checkbox
                            id={`apply-branding-template-${entry.name}`}
                            label={entry.name}
                            checked={!disabled && selected.has(entry.name)}
                            disabled={disabled}
                            onChange={() => toggleTemplate(entry.name)}
                          />
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
    </Dialog>
  );
}
