'use client';

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { MarkList, type MarkListItem } from './MarkList';
import {
  ENTRA_CAPABILITY_STATEMENTS,
  ENTRA_CONTACT_EFFECT_STATEMENTS,
  ENTRA_SCOPE_DISCLOSURES,
  buildEntraChangeRecord,
} from './entraSetupModel';

/**
 * Disclosure before consent: what Alga will read, and what it will do to
 * contacts — stated before the operator commits, not discovered afterwards.
 *
 * Two columns, because these are two different questions: one is about the
 * permissions Microsoft will be asked for, the other about what changes inside
 * Alga. The scope strings themselves are a footnote — accurate, checkable, and
 * not the thing a person reads first. Read-only by design; the only action is
 * taking a copy for a change record.
 */
export function PreConsentDisclosure(): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    const record = buildEntraChangeRecord({
      heading: t('integrations.entra.setup.disclosure.recordHeading'),
      generatedAtLine: t('integrations.entra.setup.disclosure.recordGeneratedAt', {
        time: new Date().toLocaleString(),
      }),
      scopesHeading: t('integrations.entra.setup.disclosure.scopesTitle'),
      scopes: ENTRA_SCOPE_DISCLOSURES.map((entry) => ({
        scope: entry.scope,
        gloss: t(entry.glossKey),
      })),
      contactsHeading: t('integrations.entra.setup.disclosure.contactsTitle'),
      contactEffects: ENTRA_CONTACT_EFFECT_STATEMENTS.map((statement) => t(statement.key)),
    });

    try {
      await navigator.clipboard.writeText(record);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 4000);
    } catch {
      // Clipboard permission can be refused; the text stays on screen either way.
      setCopied(false);
    }
  }, [t]);

  const toItems = (
    statements: Array<{ key: string; mark: MarkListItem['mark'] }>
  ): MarkListItem[] =>
    statements.map((statement) => ({
      id: statement.key,
      mark: statement.mark,
      text: t(statement.key),
    }));

  return (
    <div
      className="rounded-lg border border-border/70 bg-background p-4"
      id="entra-preconsent-disclosure"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 flex-shrink-0 text-primary-500" aria-hidden="true" />
        <p className="text-sm font-semibold">{t('integrations.entra.setup.disclosure.title')}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('integrations.entra.setup.disclosure.description')}
      </p>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('integrations.entra.setup.disclosure.capabilitiesTitle')}
          </p>
          <MarkList
            id="entra-disclosure-capabilities"
            className="mt-2"
            items={toItems(ENTRA_CAPABILITY_STATEMENTS)}
          />
          <p className="mt-3 text-xs text-muted-foreground" id="entra-disclosure-scopes">
            {t('integrations.entra.setup.disclosure.scopesTitle')}{': '}
            {ENTRA_SCOPE_DISCLOSURES.map((entry, index) => (
              <React.Fragment key={entry.scope}>
                {index > 0 ? ', ' : ''}
                <span className="font-mono" title={t(entry.glossKey)}>
                  {entry.scope}
                </span>
              </React.Fragment>
            ))}
            {'. '}
            {t('integrations.entra.setup.disclosure.scopesAllReadOnly')}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('integrations.entra.setup.disclosure.contactsTitle')}
          </p>
          <MarkList
            id="entra-disclosure-contact-effects"
            className="mt-2"
            items={toItems(ENTRA_CONTACT_EFFECT_STATEMENTS)}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            {t('integrations.entra.setup.disclosure.inactiveNote')}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-border/60 pt-3">
        <Button
          id="entra-disclosure-copy"
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void handleCopy()}
        >
          {copied
            ? t('integrations.entra.setup.disclosure.copied')
            : t('integrations.entra.setup.disclosure.copy')}
        </Button>
      </div>
    </div>
  );
}

export default PreConsentDisclosure;
