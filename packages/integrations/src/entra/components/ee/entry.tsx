'use client';

import React, { Suspense } from 'react';

const LazyEntraIntegrationSettings = React.lazy(() =>
  import('@enterprise/components/settings/integrations/EntraIntegrationSettings').then((mod) => ({
    default: mod.default,
  })),
);

export const EntraIntegrationSettings = (props: { canUseCipp?: boolean }): React.JSX.Element => (
  <Suspense fallback={<div className="py-8 text-center text-muted-foreground">Loading Microsoft Entra integration…</div>}>
    <LazyEntraIntegrationSettings {...props} />
  </Suspense>
);

const LazyEntraIntegrationPage = React.lazy(() =>
  import('@enterprise/components/settings/integrations/entra/EntraIntegrationPage').then((mod) => ({
    default: mod.default,
  })),
);

/** The Entra surface's own route body: guided setup, then the ops console. */
export const EntraIntegrationPage = (props: { canUseCipp?: boolean }): React.JSX.Element => (
  <Suspense fallback={<div className="py-8 text-center text-muted-foreground">Loading Microsoft Entra integration…</div>}>
    <LazyEntraIntegrationPage {...props} />
  </Suspense>
);

const LazyEntraIntegrationSummaryCard = React.lazy(() =>
  import('@enterprise/components/settings/integrations/entra/EntraIntegrationSummaryCard').then((mod) => ({
    default: mod.default,
  })),
);

/** The Identity category's compact card: state at a glance plus a way in. */
export const EntraIntegrationSummaryCard = (): React.JSX.Element => (
  <Suspense fallback={<div className="py-8 text-center text-muted-foreground">Loading Microsoft Entra integration…</div>}>
    <LazyEntraIntegrationSummaryCard />
  </Suspense>
);
