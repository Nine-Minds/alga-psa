'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  OpportunityStage,
} from '@alga-psa/types';
import {
  completeNextAction,
  createOpportunity,
  declareOpportunityStage,
  listOpportunities,
  loseOpportunity,
} from '../actions/opportunityActions';
import { getWorkQueue } from '../actions/workQueueActions';
import { updateOpportunityNextAction } from '../actions/opportunityStepActions';
import { acceptSuggestion, dismissSuggestion, snoozeSuggestion } from '../actions/suggestionActions';
import { createWhitespaceSuggestion } from '../actions/generatorActions';
import { DEFAULT_OPPORTUNITY_PAGE_SIZE } from '../lib/opportunityListPaging';
import { WorkQueue } from './queue/WorkQueue';
import { MoneyFoundCard } from './queue/MoneyFoundCard';
import { PipelineList } from './pipeline/PipelineList';
import { OpportunityBoard } from './board/OpportunityBoard';
import { CreateOpportunityDialog, type CreateOpportunityInput } from './dialogs/CreateOpportunityDialog';
import { CompleteActionDialog } from './dialogs/CompleteActionDialog';
import { LoseOpportunityDialog } from './dialogs/LoseOpportunityDialog';
import { OpportunityReportsView } from './reports/OpportunityReportsView';
import { WhitespaceGridView } from './suggestions/WhitespaceGridView';
import { TmOnePagerDialog } from './suggestions/TmOnePagerDialog';


export function OpportunitiesHub({
  initialItems,
  initialTotal,
  initialQueue,
  clients,
  draftingAvailable = false,
  eeTabs = [],
  renderClientCreator,
  userPreferenceKey,
}: {
  initialItems: IOpportunityListItem[];
  initialTotal: number;
  initialQueue: IWorkQueue;
  clients: IClient[];
  draftingAvailable?: boolean;
  renderClientCreator?: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (client: IClient) => void;
  }) => ReactNode;
  userPreferenceKey: string;
  /** EE surfaces (Meeting, Forecast) injected by the host app when the management tier allows them. */
  eeTabs?: Array<{ id: string; label: string; content: ReactNode }>;
}) {
  const { t } = useTranslation('msp/opportunities');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<IOpportunityListItem[]>(initialItems);
  const [queue, setQueue] = useState<IWorkQueue>(initialQueue);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_OPPORTUNITY_PAGE_SIZE);
  const [tab, setTab] = useState(() => searchParams.get('tab') ?? 'queue');
  const [createOpen, setCreateOpen] = useState(false);
  const [completeFor, setCompleteFor] = useState<{ id: string; stage: OpportunityStage } | null>(null);
  const [loseFor, setLoseFor] = useState<string | null>(null);
  const [onePagerFor, setOnePagerFor] = useState<string | null>(null);

  const requestedStage = searchParams.get('stage');
  const initialPipelineStage = (
    ['identified', 'qualified', 'assessment', 'proposed', 'verbal', 'won', 'lost'] as const
  ).find((stage) => stage === requestedStage);

  const refresh = useCallback(async (toPage = page, toPageSize = pageSize) => {
    const [result, nextQueue] = await Promise.all([
      // A stage drill-through filters server-side, so the totals and paging
      // describe the filtered set rather than one loaded page.
      listOpportunities({
        status: 'all',
        ...(initialPipelineStage ? { stage: initialPipelineStage } : {}),
        page: toPage,
        page_size: toPageSize,
      }),
      getWorkQueue(),
    ]);
    setItems(result.data);
    setTotal(result.total);
    setQueue(nextQueue);
    setPage(toPage);
    setPageSize(toPageSize);
  }, [page, pageSize, initialPipelineStage]);

  // The server rendered the unfiltered first page. When a stage filter arrives
  // (Reports drill-through or a deep link) or clears, re-query from page 1.
  const loadedStageRef = useRef<OpportunityStage | undefined>(undefined);
  useEffect(() => {
    if (loadedStageRef.current === initialPipelineStage) return;
    loadedStageRef.current = initialPipelineStage;
    refresh(1).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  }, [initialPipelineStage, refresh]);

  const openDeal = useCallback(
    (opportunityId: string) => router.push(`/msp/opportunities/${opportunityId}?fromTab=${tab}`),
    [router, tab]
  );

  const handleCreate = async (input: CreateOpportunityInput) => {
    try {
      const created = await createOpportunity(input);
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
      await completeNextAction(completeFor.id, { next_action: nextAction, next_action_due: dueIso });
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
      // Snoozing moves the current step's due date; the mirror follows it.
      await updateOpportunityNextAction(opportunityId, { next_action_due: snoozed.toISOString() });
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

  const handleSnoozeSuggestion = async (suggestionId: string) => {
    try {
      const until = new Date(Date.now() + 7 * 86400000).toISOString();
      await snoozeSuggestion(suggestionId, until);
      toast.success(t('opportunities.toast.suggestionSnoozed', 'Snoozed for one week'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleWhitespaceCell = async (
    client: { client_id: string; client_name: string },
    category: { category_id: string; category_name: string },
  ) => {
    try {
      const suggestion = await createWhitespaceSuggestion(client.client_id, category.category_id);
      if (suggestion.status === 'pending') {
        toast.success(t('opportunities.toast.whitespaceSuggestionCreated', 'Suggestion ready for review'));
      } else if (suggestion.status === 'dismissed') {
        toast(t('opportunities.toast.whitespaceSuggestionDismissed', 'This suggestion was previously dismissed'));
      } else {
        toast(t('opportunities.toast.whitespaceSuggestionKnown', 'This suggestion is already known'));
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeclareStage = async (
    opportunityId: string,
    stage: Exclude<OpportunityStage, 'won' | 'lost'>,
  ) => {
    try {
      await declareOpportunityStage(opportunityId, stage);
      const label = t(`opportunities.stage.${stage}`, stage.charAt(0).toUpperCase() + stage.slice(1));
      toast.success(t('opportunities.toast.stageSet', 'Stage set to {{stage}}', { stage: label }));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const openItems = useMemo(() => items.filter((i) => i.status === 'open'), [items]);
  const closedItems = useMemo(() => items.filter((i) => i.status !== 'open'), [items]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab') ?? 'queue';
    const validTabs = new Set(['queue', 'pipeline', 'board', 'suggestions', 'reports', ...eeTabs.map((item) => item.id)]);
    setTab(validTabs.has(requestedTab) ? requestedTab : 'queue');
  }, [eeTabs, searchParams]);

  const handleTabChange = (nextTab: string) => {
    setTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', nextTab);
    if (nextTab !== 'pipeline') params.delete('stage');
    router.replace(`/msp/opportunities?${params.toString()}`, { scroll: false });
  };

  const tabs = [
    {
      id: 'queue',
      label: t('opportunities.tabs.queue', 'Queue'),
      content: (
        <WorkQueue
          queue={queue}
          onCompleteAction={(id, stage) => setCompleteFor({ id, stage })}
          onOpenOpportunity={openDeal}
          onSnooze={handleSnooze}
          onMarkLost={setLoseFor}
          onAcceptSuggestion={handleAcceptSuggestion}
          onDismissSuggestion={handleDismissSuggestion}
          onSnoozeSuggestion={handleSnoozeSuggestion}
          onViewSuggestionEvidence={setOnePagerFor}
          onReviewDraft={
            draftingAvailable ? (id) => router.push(`/msp/opportunities/${id}?draft=1`) : undefined
          }
          preferenceKey={`opportunities.queue.view.${userPreferenceKey}`}
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
          initialStage={initialPipelineStage}
          onValuesChanged={() => refresh()}
          pagination={{
            currentPage: page,
            pageSize,
            totalItems: total,
            onPageChange: (p) => void refresh(p),
            // A new page size restarts the list at the top; page 4 of 50 is not page 4 of 10.
            onPageSizeChange: (size) => void refresh(1, size),
          }}
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
          onDeclareStage={handleDeclareStage}
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
                  'Drawn from your own data. Accept to create the opportunity, or dismiss it and it will not come back.'
                )}
              </p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {queue.money_found.map((item) => (
                  <MoneyFoundCard
                    key={item.suggestion_id}
                    item={item}
                    onAccept={handleAcceptSuggestion}
                    onDismiss={handleDismissSuggestion}
                    onSnooze={handleSnoozeSuggestion}
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
              onCellClick={(client, category) => void handleWhitespaceCell(client, category)}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'reports',
      label: t('opportunities.tabs.reports', 'Reports'),
      content: (
        <OpportunityReportsView
          onOpenForecast={
            eeTabs.some((item) => item.id === 'forecast') ? () => handleTabChange('forecast') : undefined
          }
          onOpenStage={(stage) => {
            setTab('pipeline');
            const params = new URLSearchParams(searchParams.toString());
            params.set('tab', 'pipeline');
            params.set('stage', stage);
            router.replace(`/msp/opportunities?${params.toString()}`, { scroll: false });
          }}
        />
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
      <CustomTabs tabs={tabs} value={tab} onTabChange={handleTabChange} />

      <CreateOpportunityDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        clients={clients}
        renderClientCreator={renderClientCreator}
        onSubmit={handleCreate}
      />
      <CompleteActionDialog
        isOpen={completeFor != null}
        onClose={() => setCompleteFor(null)}
        onSubmit={handleComplete}
        stage={completeFor?.stage}
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
    </div>
  );
}
