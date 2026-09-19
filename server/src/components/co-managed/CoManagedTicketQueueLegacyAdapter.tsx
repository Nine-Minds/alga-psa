'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildTicketListHref, parseTicketListPresentation } from '@alga-psa/tickets/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Client-gated compatibility adapter for the retired standalone queue route
 * (`/msp/co-managed/tickets`). It carries supported client/filter intent from a
 * bookmarked URL onto the canonical explicit `/msp/tickets` qualified scope.
 *
 * It is an adapter, not a second list: the same scope parser/serializer and the
 * same target as every other co-managed entry link. The inherited UI release
 * boundary is supplied by the route, so a disabled feature renders nothing and
 * starts no feature read.
 */
export default function CoManagedTicketQueueLegacyAdapter() {
  const { t } = useTranslation('msp/licensing');
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const search = searchParams?.toString() ?? '';
    const params = new URLSearchParams(search);
    // The retired queue used short names; map them onto the shared presentation
    // contract without inventing any behavior it did not have.
    const normalized = new URLSearchParams();
    const passthrough: Array<[string, string]> = [
      ['clientId', 'clientId'],
      ['search', 'searchQuery'],
      ['searchQuery', 'searchQuery'],
      ['state', 'queueState'],
      ['queueState', 'queueState'],
      ['sort', 'queueSort'],
      ['queueSort', 'queueSort'],
      ['direction', 'queueDirection'],
      ['queueDirection', 'queueDirection'],
      ['page', 'page'],
      ['pageSize', 'pageSize'],
    ];
    for (const [from, to] of passthrough) {
      const value = params.get(from);
      if (value && !normalized.has(to)) normalized.set(to, value);
    }
    const presentation = parseTicketListPresentation(normalized.toString());
    router.replace(buildTicketListHref(
      { kind: 'qualified', view: 'working', workspace: 'all' },
      presentation,
      { includeClient: Boolean(presentation.clientId) },
    ));
  }, [router, searchParams]);

  return <p role="status" className="p-6">{t('coManaged.queue.scopeUnavailable')}</p>;
}
