'use client';

import React, { Suspense } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const LazyEntraIntegrationPage = React.lazy(() =>
  import('@enterprise/components/settings/integrations/entra/EntraIntegrationPage').then((mod) => ({
    default: mod.default,
  })),
);

/** The Entra surface's own route body: guided setup, then the ops console. */
export const EntraIntegrationPage = (props: { canUseCipp?: boolean }): React.JSX.Element => {
  const { t } = useTranslation('msp/integrations');

  return (
    <Suspense fallback={<div className="py-8 text-center text-muted-foreground">{t('integrations.entra.loading')}</div>}>
      <LazyEntraIntegrationPage {...props} />
    </Suspense>
  );
};

const LazyEntraIntegrationSummaryCard = React.lazy(() =>
  import('@enterprise/components/settings/integrations/entra/EntraIntegrationSummaryCard').then((mod) => ({
    default: mod.default,
  })),
);

/** The Identity category's compact card: state at a glance plus a way in. */
export const EntraIntegrationSummaryCard = (): React.JSX.Element => {
  const { t } = useTranslation('msp/integrations');

  return (
    <Suspense fallback={<div className="py-8 text-center text-muted-foreground">{t('integrations.entra.loading')}</div>}>
      <LazyEntraIntegrationSummaryCard />
    </Suspense>
  );
};
