'use client';

import React from 'react';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ChevronRight } from 'lucide-react';
import { cn } from '@alga-psa/ui/lib/utils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { MspSsoLoginDomainsSettings } from '@alga-psa/integrations/components/settings/integrations/MspSsoLoginDomainsSettings';
import {
  getMspSsoTenantCredentialStatus,
  type MspSsoTenantCredentialStatusResult,
} from '@alga-psa/integrations/actions/integrations/mspSsoDomainActions';

/**
 * Advanced, collapsed-by-default section under Security → Single Sign-On that hosts the
 * tenant-level login-domain routing panel (the "custom identity provider" path). Until the
 * tenant has its own IdP credentials (a Keycloak realm, or its own Google / Microsoft app) the
 * panel is inert — we say so explicitly with an info notice rather than leaving admins to
 * discover it has no effect.
 */
export function MspSsoAdvancedSection(): React.JSX.Element {
  const { t } = useTranslation('msp/profile');
  const [expanded, setExpanded] = React.useState(false);
  const [status, setStatus] = React.useState<MspSsoTenantCredentialStatusResult | null>(null);

  // Load credential status lazily, the first time the section is expanded.
  React.useEffect(() => {
    if (!expanded || status) return;
    let cancelled = false;
    (async () => {
      const result = await getMspSsoTenantCredentialStatus();
      if (!cancelled) setStatus(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, status]);

  const showInertNotice = Boolean(status?.success && !status.google && !status.microsoft && !status.keycloak);

  return (
    <Card className="mt-6">
      <button
        id="msp-sso-advanced-toggle"
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls="msp-sso-advanced-body"
        className="flex w-full items-center gap-2 px-6 py-4 text-left"
      >
        <ChevronRight
          className={cn('h-4 w-4 shrink-0 transition-transform duration-300', expanded && 'rotate-90')}
        />
        <span className="flex flex-col">
          <span className="font-medium">
            {t('security.sso.advanced.title', { defaultValue: 'Advanced: custom identity provider routing' })}
          </span>
          <span className="text-sm text-muted-foreground">
            {t('security.sso.advanced.description', {
              defaultValue:
                'Route MSP login SSO to your own identity provider using verified login domains. Required when staff sign in through your own Keycloak realm or your own Google / Microsoft application.',
            })}
          </span>
        </span>
      </button>

      {expanded && (
        <CardContent id="msp-sso-advanced-body" className="space-y-4 pt-0">
          {showInertNotice && (
            <Alert variant="info">
              <AlertDescription>
                {t('security.sso.advanced.inertNotice', {
                  defaultValue:
                    'No tenant identity provider is configured, so domain claims currently have no effect. Configure Keycloak above, or on Enterprise Edition your Google / Microsoft app credentials, then claim your staff login domain here.',
                })}
              </AlertDescription>
            </Alert>
          )}
          <MspSsoLoginDomainsSettings />
        </CardContent>
      )}
    </Card>
  );
}

export default MspSsoAdvancedSection;
