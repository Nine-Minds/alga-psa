'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityListItem } from '@alga-psa/types';
import { createOpportunity, getClientDefaultCurrency, listOpportunities } from '../actions';
import { PipelineList } from './pipeline/PipelineList';
import { CreateOpportunityDialog, type CreateOpportunityInput } from './dialogs/CreateOpportunityDialog';

/**
 * The Opportunities tab on client detail: this client's deals plus a
 * create shortcut with the client already fixed.
 */
export function ClientOpportunitiesTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<IOpportunityListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await listOpportunities({ status: 'all', client_id: clientId, page: 1, page_size: 100 });
      setItems(result.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (input: CreateOpportunityInput) => {
    try {
      const currency = await getClientDefaultCurrency(clientId);
      const created = await createOpportunity({ ...input, currency_code: currency });
      toast.success(t('opportunities.toast.created', 'Opportunity created'));
      router.push(`/msp/opportunities/${(created as { opportunity_id: string }).opportunity_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  return (
    <div id={`client-opportunities-tab-${clientId}`}>
      <div className="mb-3 flex justify-end">
        <Button id="client-opportunities-new" size="sm" onClick={() => setCreateOpen(true)}>
          {t('opportunities.new', 'New opportunity')}
        </Button>
      </div>
      {loaded && items.length === 0 ? (
        <EmptyState
          title={t('opportunities.clientTab.emptyTitle', 'No opportunities for this client yet')}
          description={t('opportunities.clientTab.emptyBody', 'Create one, or let a quote start the trail.')}
        />
      ) : (
        <PipelineList items={items} onOpen={(id) => router.push(`/msp/opportunities/${id}`)} />
      )}
      <CreateOpportunityDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        lockedClient={{ client_id: clientId, client_name: clientName }}
        onSubmit={handleCreate}
      />
    </div>
  );
}
