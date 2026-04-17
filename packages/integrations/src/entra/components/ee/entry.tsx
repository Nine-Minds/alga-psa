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
