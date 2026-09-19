'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { resolveCoManagedLegacyOperation } from '@/lib/actions/coManagedActions';

/**
 * Presentation adapter for legacy sponsor links. An operation ID resolves to
 * its authorized canonical client and exact relationship, then navigates to the
 * matching client section. A supplied client ID that conflicts with the
 * persisted operation yields an unavailable state rather than an unauthorized
 * redirect. Customer routes (no sponsor selectors) render their children
 * unchanged. Discovery starts only while the release boundary is usable.
 */
export default function CoManagedLegacyRedirect({ operationId, clientId, section, children }: {
  operationId?: string;
  clientId?: string;
  section?: string;
  children: ReactNode;
}) {
  // Customer home and selector-free routes never mount the redirecting child,
  // so no router context or feature discovery is required for them.
  if (!operationId && !clientId) return <>{children}</>;
  return <SponsorLinkRedirect operationId={operationId} clientId={clientId} section={section} />;
}

function SponsorLinkRedirect({ operationId, clientId, section }: {
  operationId?: string;
  clientId?: string;
  section?: string;
}) {
  const { t } = useTranslation('msp/licensing');
  const { enabled, loading, error } = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  const usable = enabled === true && !loading && !error;
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!usable) return;
    const current = ++generation.current;
    void (async () => {
      if (operationId) {
        const target = await resolveCoManagedLegacyOperation(operationId, clientId);
        if (generation.current !== current) return;
        if (!target) { setUnavailable(true); return; }
        const query = new URLSearchParams({ tab: 'co-managed', relationshipId: target.relationshipId });
        if (section) query.set('section', section);
        router.replace(`/msp/clients/${encodeURIComponent(target.clientId)}?${query.toString()}`);
        return;
      }
      router.replace(`/msp/clients/${encodeURIComponent(clientId!)}?tab=co-managed`);
    })().catch(() => { if (generation.current === current) setUnavailable(true); });
    return () => { generation.current += 1; };
  }, [usable, operationId, clientId, section, router]);

  if (!usable) return null;
  if (unavailable) {
    return <p role="status" className="p-6 text-[rgb(var(--color-text-600))]">
      {t('coManaged.unavailable', { defaultValue: 'This co-managed link is unavailable.' })}
    </p>;
  }
  return <p role="status" className="p-6 text-[rgb(var(--color-text-600))]">
    {t('coManaged.loading', { defaultValue: 'Loading…' })}
  </p>;
}
