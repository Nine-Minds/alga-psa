'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ENTRA_SCOPE_DISCLOSURES } from './entraSetupModel';

interface EntraDirectConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
  appRegistrationName?: string | null;
}

/**
 * The last screen before a full-page redirect to Microsoft. It exists because
 * the redirect is irreversible from the operator's point of view: they leave
 * Alga, sign in, and are asked to approve permissions with no statement of what
 * was requested or who has to approve it. This says both, plus the fact that
 * the connection then runs as a service principal rather than as the person who
 * happened to click.
 */
export function EntraDirectConsentDialog({
  open,
  onOpenChange,
  onConfirm,
  busy = false,
  appRegistrationName,
}: EntraDirectConsentDialogProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button
        id="entra-direct-consent-cancel"
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={busy}
      >
        {t('integrations.entra.setup.directConsent.cancel')}
      </Button>
      <Button id="entra-direct-consent-continue" type="button" onClick={onConfirm} disabled={busy}>
        {busy
          ? t('integrations.entra.setup.directConsent.redirecting')
          : t('integrations.entra.setup.directConsent.continue')}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      id="entra-direct-consent-dialog"
      footer={footer}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('integrations.entra.setup.directConsent.title')}</DialogTitle>
          <DialogDescription>
            {t('integrations.entra.setup.directConsent.intro')}
            {appRegistrationName ? ` App registration: ${appRegistrationName}.` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ul className="space-y-2" id="entra-direct-consent-scopes">
            {ENTRA_SCOPE_DISCLOSURES.map((entry) => (
              <li key={entry.scope} className="min-w-0 text-sm">
                <p className="truncate font-mono text-xs text-foreground">{entry.scope}</p>
                <p className="text-sm text-muted-foreground">{t(entry.glossKey)}</p>
              </li>
            ))}
          </ul>

          <p className="text-sm text-muted-foreground">
            {t('integrations.entra.setup.directConsent.adminNote')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('integrations.entra.setup.directConsent.servicePrincipalNote')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EntraDirectConsentDialog;
