'use client';

import type { ReactNode } from 'react';
import type { ProductCode } from '@alga-psa/types';
import { signOut } from 'next-auth/react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedAcceptanceBoundary from './CoManagedAcceptanceBoundary';

/**
 * Presentation only. Never use this release flag in backend authorization.
 *
 * `fallback` renders once the flag has *resolved* to unavailable. It stays
 * unrendered while the flag is still loading so a transient default-off never
 * flashes it. Callers that add feature UI beside existing UI can omit it (the
 * block simply disappears); callers that *replace* a whole route with feature
 * UI must supply one, or the route renders blank when the flag is off.
 */
export function CoManagedFeatureBoundary({ children, fallback, openWhenUnresolved = false }: {
  children: ReactNode;
  fallback?: ReactNode;
  /** Render children when the flag could not be evaluated at all (e.g. PostHog blocked). */
  openWhenUnresolved?: boolean;
}) {
  const { enabled, loading, error, resolved } = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  if (loading) return null;
  if (openWhenUnresolved && resolved === false) return <>{children}</>;
  if (enabled !== true || error) return <>{fallback ?? null}</>;
  return <>{children}</>;
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

export function CoManagedWorkspaceBoundary({ children, productCode, requireAcceptance = false }: {
  children: ReactNode;
  productCode: ProductCode;
  requireAcceptance?: boolean;
}) {
  // The workspace is the whole product for a co-managed tenant. A release flag
  // that is deliberately off closes it with an explanation; a flag that could
  // not be evaluated (an ad blocker, PostHog unreachable) must not blank it.
  return productCode === 'co_managed'
    ? <CoManagedFeatureBoundary openWhenUnresolved fallback={<CoManagedWorkspaceUnavailable />}>{requireAcceptance
      ? <CoManagedAcceptanceBoundary>{children}</CoManagedAcceptanceBoundary> : children}</CoManagedFeatureBoundary>
    : <>{children}</>;
}
