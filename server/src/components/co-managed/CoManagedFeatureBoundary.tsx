'use client';

import type { ReactNode } from 'react';
import type { ProductCode } from '@alga-psa/types';
import { signOut } from 'next-auth/react';
import { useCapability } from '@alga-psa/ui/hooks';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedAcceptanceBoundary from './CoManagedAcceptanceBoundary';

/**
 * Presentation only; the server adapters are the authority. `admits` (the
 * default) shows start affordances, `serves` shows state that already exists.
 *
 * `fallback` renders once the capability has *resolved* closed. Callers that add
 * feature UI beside existing UI omit it (the block simply disappears); callers
 * that *replace* a whole route with feature UI must supply one.
 */
export function CoManagedFeatureBoundary({ children, fallback, mode = 'admits', openWhenUnresolved = false }: {
  children: ReactNode;
  fallback?: ReactNode;
  mode?: 'admits' | 'serves';
  /** Render children when nothing answered at all (no server bootstrap); the server still enforces. */
  openWhenUnresolved?: boolean;
}) {
  const { enabled, admitted, resolved } = useCapability('co-managed');
  if (openWhenUnresolved && !resolved) return <>{children}</>;
  return <>{(mode === 'admits' ? admitted : enabled) ? children : fallback ?? null}</>;
}

/** A co-managed workspace has no other UI to fall back to: say why it is closed. */
function CoManagedWorkspaceUnavailable() {
  const { t } = useTranslation('msp/licensing');
  return <div className="mx-auto max-w-3xl p-6">
    <Card><CardHeader><CardTitle>{t('coManaged.workspaceUnavailable.title', { defaultValue: 'Co-managed IT is not available' })}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p>{t('coManaged.workspaceUnavailable.description', {
          defaultValue: 'This workspace is not available right now. Contact your IT provider if you expected to use it.' })}</p>
        <Button id="co-managed-unavailable-sign-out" variant="ghost"
          onClick={() => void signOut({ callbackUrl: '/auth/msp/signin', redirect: true })}>
          {t('coManaged.acceptance.signOut', { defaultValue: 'Sign out' })}
        </Button>
      </CardContent>
    </Card>
  </div>;
}

/**
 * Wraps the whole MSP shell. Any product other than `co_managed` renders its
 * children untouched, so a PSA tenant sees no change and starts no feature read.
 */
export function CoManagedWorkspaceBoundary({ children, productCode, requireAcceptance = false }: {
  children: ReactNode;
  productCode: ProductCode;
  requireAcceptance?: boolean;
}) {
  // The workspace is the whole product for a co-managed tenant: a capability
  // that is deliberately closed explains itself; one that could not be
  // evaluated at all must not blank it (the server guards still hold).
  return productCode === 'co_managed'
    ? <CoManagedFeatureBoundary mode="serves" openWhenUnresolved fallback={<CoManagedWorkspaceUnavailable />}>{requireAcceptance
      ? <CoManagedAcceptanceBoundary>{children}</CoManagedAcceptanceBoundary> : children}</CoManagedFeatureBoundary>
    : <>{children}</>;
}
