'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { Button } from '@alga-psa/ui/components/Button';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  IClient,
  IOpportunityListItem,
  IWorkQueue,
  OpportunityLossReason,
} from '@alga-psa/types';
import {
  completeNextAction,
  createOpportunity,
  declareQualified,
  listOpportunities,
  loseOpportunity,
  updateOpportunity,
} from '../actions/opportunityActions';
import { getWorkQueue } from '../actions/workQueueActions';
import { acceptSuggestion, dismissSuggestion } from '../actions/suggestionActions';
import { getClientDefaultCurrency } from '../actions/opportunityDefaults';
import { WorkQueue } from './queue/WorkQueue';
import { MoneyFoundCard } from './queue/MoneyFoundCard';
import { PipelineList } from './pipeline/PipelineList';
import { OpportunityBoard } from './board/OpportunityBoard';
import { CreateOpportunityDialog, type CreateOpportunityInput } from './dialogs/CreateOpportunityDialog';
import { CompleteActionDialog } from './dialogs/CompleteActionDialog';
import { LoseOpportunityDialog } from './dialogs/LoseOpportunityDialog';
import { WhitespaceGridView } from './suggestions/WhitespaceGridView';
import { TmOnePagerDialog } from './suggestions/TmOnePagerDialog';

const PAGE_SIZE = 50;

export function OpportunitiesHub({
  initialItems,
  initialTotal,
  initialQueue,
  clients,
  draftingAvailable = false,
  eeTabs = [],
}: {
  initialItems: IOpportunityListItem[];
  initialTotal: number;
  initialQueue: IWorkQueue;
  clients: IClient[];
  draftingAvailable?: boolean;
  /** EE surfaces (Meeting, Forecast) injected by the host app when the management tier allows them. */
  eeTabs?: Array<{ id: string; label: string; content: ReactNode }>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<IOpportunityListItem[]>(initialItems);
  const [queue, setQueue] = useState<IWorkQueue>(initialQueue);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('queue');
  const [createOpen, setCreateOpen] = useState(false);
  const [completeFor, setCompleteFor] = useState<string | null>(null);
  const [loseFor, setLoseFor] = useState<string | null>(null);
  const [onePagerFor, setOnePagerFor] = useState<string | null>(null);
  const [whitespaceCreate, setWhitespaceCreate] = useState<{
    client: { client_id: string; client_name: string };
    categoryName: string;
  } | null>(null);

  const refresh = useCallback(async (toPage = page) => {
    const [result, nextQueue] = await Promise.all([
      listOpportunities({ status: 'all', page: toPage, page_size: PAGE_SIZE }),
      getWorkQueue(),
    ]);
    setItems(result.data);
    setTotal(result.total);
    setQueue(nextQueue);
    setPage(toPage);
  }, [page]);

  const openDeal = useCallback(
    (opportunityId: string) => router.push(`/msp/opportunities/${opportunityId}`),
    [router]
  );

  const handleCreate = async (input: CreateOpportunityInput) => {
    try {
      const currency = await getClientDefaultCurrency(input.client_id);
      const created = await createOpportunity({ ...input, currency_code: currency });
      toast.success(t('opportunities.toast.created', 'Opportunity created'));
      openDeal((created as any).opportunity_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const handleComplete = async (nextAction: string, dueIso: string) => {
    if (!completeFor) return;
    try {
      await completeNextAction(completeFor, { next_action: nextAction, next_action_due: dueIso });
      toast.success(t('opportunities.toast.actionCompleted', 'Done. Next action scheduled.'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const handleLose = async (input: { loss_reason: OpportunityLossReason; loss_notes?: string; lost_to?: string }) => {
    if (!loseFor) return;
    try {
      await loseOpportunity(loseFor, input);
      toast.success(t('opportunities.toast.lost', 'Marked lost'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const handleSnooze = async (opportunityId: string) => {
    const item = items.find((i) => i.opportunity_id === opportunityId);
    const base = item?.next_action_due ? new Date(item.next_action_due) : new Date();
    const snoozed = new Date(Math.max(base.getTime(), Date.now()) + 3 * 86400000);
    try {
      await updateOpportunity(opportunityId, { next_action_due: snoozed.toISOString() });
      toast.success(t('opportunities.toast.snoozed', 'Snoozed for a few days'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAcceptSuggestion = async (suggestionId: string) => {
    try {
      const created = await acceptSuggestion(suggestionId);
      toast.success(t('opportunities.toast.suggestionAccepted', 'Opportunity created from the suggestion'));
      const createdId = (created as { opportunity_id?: string })?.opportunity_id;
      if (createdId) openDeal(createdId);
      else await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDismissSuggestion = async (suggestionId: string) => {
    try {
      await dismissSuggestion(suggestionId);
      toast.success(t('opportunities.toast.suggestionDismissed', 'Dismissed. It will not come back.'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeclareQualified = async (opportunityId: string) => {
    try {
      await declareQualified(opportunityId, undefined);
      toast.success(t('opportunities.toast.qualified', 'Qualified checkpoint recorded'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const openItems = useMemo(() => items.filter((i) => i.status === 'open'), [items]);
  const closedItems = useMemo(() => items.filter((i) => i.status !== 'open'), [items]);

  const tabs = [
    {
      id: 'queue',
      label: t('opportunities.tabs.queue', 'Queue'),
      content: (
        <WorkQueue
          queue={queue}
          onCompleteAction={setCompleteFor}
          onOpenOpportunity={openDeal}
          onSnooze={handleSnooze}
          onMarkLost={setLoseFor}
          onAcceptSuggestion={handleAcceptSuggestion}
          onDismissSuggestion={handleDismissSuggestion}
          onViewSuggestionEvidence={setOnePagerFor}
          onReviewDraft={
            draftingAvailable ? (id) => router.push(`/msp/opportunities/${id}?draft=1`) : undefined
          }
        />
      ),
    },
    {
      id: 'pipeline',
      label: t('opportunities.tabs.pipeline', 'Pipeline'),
      content: (
        <PipelineList
          items={items}
          onOpen={openDeal}
          pagination={{ currentPage: page, pageSize: PAGE_SIZE, totalItems: total, onPageChange: (p) => void refresh(p) }}
        />
      ),
    },
    {
      id: 'board',
      label: t('opportunities.tabs.board', 'Board'),
      content: (
        <OpportunityBoard
          items={openItems}
          recentlyClosed={closedItems}
          onOpen={openDeal}
          onDeclareQualified={handleDeclareQualified}
          onMarkLost={setLoseFor}
        />
      ),
    },
    {
      id: 'suggestions',
      label: t('opportunities.tabs.suggestions', 'Suggestions'),
      content: (
        <div className="mx-auto w-full max-w-4xl space-y-8">
          {queue.money_found.length === 0 ? (
            <EmptyState
              title={t('opportunities.suggestions.emptyTitle', 'No suggestions right now')}
              description={t(
                'opportunities.suggestions.emptyBody',
                'Generators watch your contracts, billing, and assets, and surface deals here as they find them.'
              )}
            />
          ) : (
            <div>
              <p className="mb-3 text-sm text-[rgb(var(--color-text-500))]">
                {t(
                  'opportunities.suggestions.intro',
                  'Found in your data. Accept to create the opportunity, or dismiss and it stays gone.'
                )}
              </p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {queue.money_found.map((item) => (
                  <MoneyFoundCard
                    key={item.suggestion_id}
                    item={item}
                    onAccept={handleAcceptSuggestion}
                    onDismiss={handleDismissSuggestion}
                    onViewEvidence={setOnePagerFor}
                  />
                ))}
              </div>
            </div>
          )}
          <div>
            <h3 className="mb-1 text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {t('opportunities.whitespace.title', 'The whole book')}
            </h3>
            <p className="mb-3 text-[13px] text-[rgb(var(--color-text-500))]">
              {t(
                'opportunities.whitespace.subtitle',
                'What each agreement client buys. An empty cell is a conversation you have not had yet.'
              )}
            </p>
            <WhitespaceGridView
              onCellClick={(client, categoryName) => setWhitespaceCreate({ client, categoryName })}
            />
          </div>
        </div>
      ),
    },
    ...eeTabs,
  ];

  return (
    <div id="opportunities-hub" className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
          {t('opportunities.pageTitle', 'Opportunities')}
        </h1>
        <Button id="opportunities-new-button" size="sm" onClick={() => setCreateOpen(true)}>
          {t('opportunities.new', 'New opportunity')}
        </Button>
      </div>
      <CustomTabs tabs={tabs} value={tab} onTabChange={setTab} />

      <CreateOpportunityDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        clients={clients}
        onSubmit={handleCreate}
      />
      <CompleteActionDialog
        isOpen={completeFor != null}
        onClose={() => setCompleteFor(null)}
        onSubmit={handleComplete}
      />
      <LoseOpportunityDialog isOpen={loseFor != null} onClose={() => setLoseFor(null)} onSubmit={handleLose} />
      <TmOnePagerDialog
        suggestionId={onePagerFor}
        isOpen={onePagerFor != null}
        onClose={() => setOnePagerFor(null)}
        onCreateOpportunity={(id) => {
          setOnePagerFor(null);
          void handleAcceptSuggestion(id);
        }}
      />
      {whitespaceCreate ? (
        <CreateOpportunityDialog
          isOpen
          onClose={() => setWhitespaceCreate(null)}
          lockedClient={whitespaceCreate.client}
          defaults={{
            title: t('opportunities.whitespace.dealTitle', 'Add {{category}}', {
              category: whitespaceCreate.categoryName,
            }),
            type: 'expansion',
          }}
          onSubmit={async (input) => {
            await handleCreate(input);
            setWhitespaceCreate(null);
          }}
        />
      ) : null}
    </div>
  );
}
