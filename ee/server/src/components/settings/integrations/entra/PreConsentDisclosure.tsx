'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  ENTRA_CONTACT_EFFECT_KEYS,
  ENTRA_SCOPE_DISCLOSURES,
  buildEntraChangeRecord,
} from './entraSetupModel';

/**
 * Disclosure before consent: what Alga will read, and what it will do to
 * contacts — stated before the operator commits, not discovered afterwards.
 * Read-only by design; the only action is taking a copy for a change record.
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
      contactEffects: ENTRA_CONTACT_EFFECT_KEYS.map((key) => t(key)),
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

  return (
    <div
      className="space-y-4 rounded-lg border border-border/70 bg-background p-4"
      id="entra-preconsent-disclosure"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t('integrations.entra.setup.disclosure.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('integrations.entra.setup.disclosure.description')}
          </p>
        </div>
        <Button
          id="entra-disclosure-copy"
          type="button"
          size="sm"
          variant="outline"
          className="flex-shrink-0"
          onClick={() => void handleCopy()}
        >
          {copied
            ? t('integrations.entra.setup.disclosure.copied')
            : t('integrations.entra.setup.disclosure.copy')}
        </Button>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('integrations.entra.setup.disclosure.scopesTitle')}
        </p>
        <ul className="mt-2 space-y-2" id="entra-disclosure-scopes">
          {ENTRA_SCOPE_DISCLOSURES.map((entry) => (
            <li key={entry.scope} className="min-w-0 text-sm">
              <p className="truncate font-mono text-xs text-foreground">{entry.scope}</p>
              <p className="text-sm text-muted-foreground">{t(entry.glossKey)}</p>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('integrations.entra.setup.disclosure.contactsTitle')}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-4" id="entra-disclosure-contact-effects">
          {ENTRA_CONTACT_EFFECT_KEYS.map((key) => (
            <li key={key} className="text-sm text-muted-foreground">
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default PreConsentDisclosure;
