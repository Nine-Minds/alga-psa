'use client';

import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ArrowLeft } from 'lucide-react';
import { ProviderCredentialsWorkbench } from '@alga-psa/integrations/components/settings/integrations/ProviderCredentialsWorkbench';

/**
 * Customer-owned Google / Microsoft application credentials for a co-managed
 * workspace.
 *
 * Scope is deliberately one capability wide. `/msp/settings/integrations` hosts
 * the same workbench, but also accounting, RMM, payments and the other
 * integration categories the co-managed capability boundary excludes, so that
 * route stays denied and this route renders the provider workbench alone.
 *
 * The workbench and every server action beneath it are the ones PSA uses; this
 * component adds no persistence and relaxes no guard. Product boundary is the
 * route rule, RBAC is `system_settings:update` inside the actions, and tenant
 * ownership and secret redaction are the actions' own.
 */
export default function CoManagedProviderSetup(): React.JSX.Element {
  const { t } = useTranslation('msp/settings');
  const isEnterpriseEdition = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
      <Button id="co-managed-providers-back-to-email" variant="ghost" size="sm" asChild className="h-auto px-0">
        <Link href="/msp/settings/email">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('coManaged.providers.backToEmail', { defaultValue: 'Back to Email settings' })}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{t('coManaged.providers.title', { defaultValue: 'Email and identity providers' })}</CardTitle>
          <CardDescription>
            {t('coManaged.providers.description', {
              defaultValue:
                'Register your own Google or Microsoft application for inbound email, staff sign-in and directory setup. These credentials belong to your workspace.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProviderCredentialsWorkbench canUseTeams={isEnterpriseEdition} isEnterpriseEdition={isEnterpriseEdition} />
        </CardContent>
      </Card>
    </div>
  );
}
