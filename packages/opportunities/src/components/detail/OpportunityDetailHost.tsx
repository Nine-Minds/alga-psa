'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  IOpportunityDetail,
  IOpportunityFollowUpDraft,
  IProjectTemplate,
  IStatus,
  OpportunityConfidence,
  OpportunityLossReason,
} from '@alga-psa/types';
import { getProjectStatuses, getTemplates } from '@alga-psa/projects/actions';
import {
  completeNextAction,
  declareQualified,
  deleteOpportunity,
  linkQuoteToOpportunity,
  listLinkableQuotesForOpportunity,
  loseOpportunity,
  unlinkQuoteFromOpportunity,
  updateOpportunity,
  winOpportunity,
} from '../../actions/opportunityActions';
import type { LinkableOpportunityQuote } from '../../actions/opportunityActions';
import { OpportunityDetailView } from './OpportunityDetailView';
import { OpportunityTimelinePanel } from './OpportunityTimelinePanel';
import { CompleteActionDialog } from '../dialogs/CompleteActionDialog';
import { LoseOpportunityDialog } from '../dialogs/LoseOpportunityDialog';
import { EditValuesDialog } from '../dialogs/EditValuesDialog';
import { EditOpportunityDialog } from '../dialogs/EditOpportunityDialog';
import { DraftEditorDialog } from '../dialogs/DraftEditorDialog';

const formatQuoteAmount = (quote: LinkableOpportunityQuote) =>
  formatCurrencyFromMinorUnits(quote.total_amount, undefined, quote.currency_code);

export interface OpportunityDraftingCallbacks {
  generate: (opportunityId: string, request: {
    instructions: string;
    current_draft?: IOpportunityFollowUpDraft;
  }) => Promise<IOpportunityFollowUpDraft>;
  getRecipient: (opportunityId: string) => Promise<string | null>;
  send: (opportunityId: string, input: { subject: string; body: string }) => Promise<{
    recipient: string;
    messageId: string | null;
  }>;
}

/** Client host for the detail screen: wires the view to server actions. */
export function OpportunityDetailHost({
  detail,
  drafting,
  autoOpenDraft = false,
  commitments,
}: {
  detail: IOpportunityDetail;
  /** Injected by the host app only when the tenant's AI module allows drafting. */
  drafting?: OpportunityDraftingCallbacks;
  /** Deep link from the queue's "Review the draft" primary. */
  autoOpenDraft?: boolean;
  /** EE commitments ledger section, injected when the management tier allows it. */
  commitments?: ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [loseOpen, setLoseOpen] = useState(false);
  const [winOpen, setWinOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [winning, setWinning] = useState(false);
  const [winChoicesLoading, setWinChoicesLoading] = useState(false);
  const [projectTemplates, setProjectTemplates] = useState<IProjectTemplate[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<IStatus[]>([]);
  const [winProjectTemplateId, setWinProjectTemplateId] = useState('');
  const [winProjectStatusId, setWinProjectStatusId] = useState('');
  const [winProjectName, setWinProjectName] = useState(detail.title);
  const [winProjectStartDate, setWinProjectStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [valuesOpen, setValuesOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [linkQuoteOpen, setLinkQuoteOpen] = useState(false);
  const [linkableQuotes, setLinkableQuotes] = useState<LinkableOpportunityQuote[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState('');
  const [linkingQuote, setLinkingQuote] = useState(false);
  const [draftOpen, setDraftOpen] = useState(Boolean(drafting && autoOpenDraft));

  const refresh = () => router.refresh();

  useEffect(() => {
    if (!winOpen) return;
    let active = true;
    setWinChoicesLoading(true);
    Promise.all([getTemplates(), getProjectStatuses()])
      .then(([templates, statuses]) => {
        if (!active) return;
        setProjectTemplates(templates);
        if (Array.isArray(statuses)) {
          setProjectStatuses(statuses);
          setWinProjectStatusId(statuses[0]?.status_id ?? '');
        }
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setWinChoicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [winOpen]);

  const run = async (fn: () => Promise<unknown>, successMessage: string) => {
    try {
      await fn();
      toast.success(successMessage);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  return (
    <>
      <OpportunityDetailView
        detail={detail}
        timeline={
          <OpportunityTimelinePanel
            key={`${detail.opportunity_id}:${detail.updated_at}`}
            opportunityId={detail.opportunity_id}
          />
        }
        commitments={commitments}
        onEditValues={() => setValuesOpen(true)}
        onEditDetails={() => setEditOpen(true)}
        onDraftFollowUp={drafting ? () => setDraftOpen(true) : undefined}
        onCompleteAction={() => setCompleteOpen(true)}
        onDeclareQualified={(id) =>
          void run(() => declareQualified(id, undefined), t('opportunities.toast.qualified', 'Qualified checkpoint recorded'))
        }
        onConfidenceChange={(id, confidence: OpportunityConfidence) =>
          void run(() => updateOpportunity(id, { confidence }), t('opportunities.toast.saved', 'Saved'))
        }
        onWin={() => setWinOpen(true)}
        onLose={() => setLoseOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onCreateQuote={() => {
          const params = new URLSearchParams({
            tab: 'quotes',
            quoteId: 'new',
            opportunityId: detail.opportunity_id,
            clientId: detail.client_id,
            title: `Quote for ${detail.title}`,
          });
          if (detail.contact_id) params.set('contactId', detail.contact_id);
          router.push(`/msp/billing?${params.toString()}`);
        }}
        onLinkQuote={async () => {
          try {
            const quotes = await listLinkableQuotesForOpportunity(detail.opportunity_id);
            setLinkableQuotes(quotes);
            setSelectedQuoteId(quotes[0]?.quote_id ?? '');
            setLinkQuoteOpen(true);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          }
        }}
        onOpenQuote={(quoteId) => router.push(`/msp/billing?tab=quotes&quoteId=${quoteId}&mode=edit`)}
        onUnlinkQuote={(quoteId) => void run(
          () => unlinkQuoteFromOpportunity(detail.opportunity_id, quoteId),
          t('opportunities.toast.quoteUnlinked', 'Quote unlinked'),
        )}
      />

      <Dialog
        id="opportunity-link-quote-dialog"
        isOpen={linkQuoteOpen}
        onClose={() => setLinkQuoteOpen(false)}
        title={t('opportunities.linkQuoteDialog.title', 'Link an existing quote')}
      >
        <div className="space-y-4 pt-1">
          {linkableQuotes.length === 0 ? (
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('opportunities.linkQuoteDialog.empty', 'No unlinked quotes are available for this client.')}
            </p>
          ) : (
            <CustomSelect
              id="opportunity-link-quote-select"
              value={selectedQuoteId}
              onValueChange={setSelectedQuoteId}
              options={linkableQuotes.map((quote) => ({
                value: quote.quote_id,
                label: `${quote.quote_number} · ${quote.title} · ${formatQuoteAmount(quote)}`,
              }))}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button id="opportunity-link-quote-cancel" variant="ghost" size="sm" onClick={() => setLinkQuoteOpen(false)} disabled={linkingQuote}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              id="opportunity-link-quote-confirm"
              size="sm"
              disabled={!selectedQuoteId || linkingQuote}
              onClick={async () => {
                setLinkingQuote(true);
                try {
                  await linkQuoteToOpportunity(detail.opportunity_id, selectedQuoteId);
                  toast.success(t('opportunities.toast.quoteLinked', 'Quote linked'));
                  setLinkQuoteOpen(false);
                  refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setLinkingQuote(false);
                }
              }}
            >
              {t('opportunities.linkQuoteDialog.confirm', 'Link quote')}
            </Button>
          </div>
        </div>
      </Dialog>

      {drafting ? (
        <DraftEditorDialog
          isOpen={draftOpen}
          onClose={() => setDraftOpen(false)}
          onGenerate={(request) => drafting.generate(detail.opportunity_id, request)}
          onGetRecipient={() => drafting.getRecipient(detail.opportunity_id)}
          onSend={async (input) => {
            const result = await drafting.send(detail.opportunity_id, input);
            refresh();
            return result;
          }}
        />
      ) : null}
      <EditOpportunityDialog
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        initial={{
          title: detail.title,
          opportunity_type: detail.opportunity_type,
          next_action: detail.next_action ?? '',
          next_action_due: detail.next_action_due ?? new Date().toISOString(),
          expected_close_date: detail.expected_close_date?.slice(0, 10) ?? null,
        }}
        onSubmit={(input) =>
          run(() => updateOpportunity(detail.opportunity_id, input), t('opportunities.toast.saved', 'Saved'))
        }
      />
      <EditValuesDialog
        isOpen={valuesOpen}
        onClose={() => setValuesOpen(false)}
        currencyCode={detail.currency_code}
        initial={{ mrr_cents: detail.mrr_cents, nrr_cents: detail.nrr_cents, hardware_cents: detail.hardware_cents }}
        onSubmit={(values) =>
          run(() => updateOpportunity(detail.opportunity_id, values), t('opportunities.toast.saved', 'Saved'))
        }
      />
      <CompleteActionDialog
        isOpen={completeOpen}
        onClose={() => setCompleteOpen(false)}
        onSubmit={(nextAction, dueIso) =>
          run(
            () => completeNextAction(detail.opportunity_id, { next_action: nextAction, next_action_due: dueIso }),
            t('opportunities.toast.actionCompleted', 'Done. Next action scheduled.')
          )
        }
      />
      <LoseOpportunityDialog
        isOpen={loseOpen}
        onClose={() => setLoseOpen(false)}
        onSubmit={(input: { loss_reason: OpportunityLossReason; loss_notes?: string; lost_to?: string }) =>
          run(() => loseOpportunity(detail.opportunity_id, input), t('opportunities.toast.lost', 'Marked lost'))
        }
      />
      <Dialog
        id="opportunity-delete-dialog"
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('opportunities.deleteDialog.title', 'Delete opportunity')}
      >
        <div className="space-y-4 pt-1">
          <p className="text-sm text-[rgb(var(--color-text-700))]">
            {t(
              'opportunities.deleteDialog.body',
              'Delete {{number}} permanently? This cannot be undone. Opportunities with linked quotes cannot be deleted.',
              { number: detail.opportunity_number }
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              id="opportunity-delete-cancel"
              variant="ghost"
              size="sm"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              id="opportunity-delete-confirm"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await deleteOpportunity(detail.opportunity_id);
                  toast.success(t('opportunities.toast.deleted', 'Opportunity deleted'));
                  router.push('/msp/opportunities');
                  router.refresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {t('common.delete', 'Delete')}
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        id="opportunity-win-dialog"
        isOpen={winOpen}
        onClose={() => setWinOpen(false)}
        title={t('opportunities.winDialog.title', 'Mark won')}
      >
        <div className="space-y-4 pt-1">
          <p className="text-sm text-[rgb(var(--color-text-700))]">
            {detail.client_lifecycle_status === 'prospect'
              ? t(
                  'opportunities.winDialog.bodyProspect',
                  '{{client}} becomes an active client. Convert the accepted quote to an agreement from the quote screen afterward.',
                  { client: detail.client_name }
                )
              : t(
                  'opportunities.winDialog.body',
                  'The deal closes as won. Convert the accepted quote to an agreement from the quote screen afterward.'
                )}
          </p>
          <div className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-3">
            <div>
              <Label htmlFor="opportunity-win-project-template">
                {t('opportunities.winDialog.projectTemplate', 'Create an onboarding project (optional)')}
              </Label>
              <CustomSelect
                id="opportunity-win-project-template"
                value={winProjectTemplateId}
                onValueChange={setWinProjectTemplateId}
                disabled={winChoicesLoading}
                options={[
                  { value: '', label: t('opportunities.winDialog.noProject', 'Do not create a project') },
                  ...projectTemplates.map((template) => ({
                    value: template.template_id,
                    label: template.template_name,
                  })),
                ]}
              />
            </div>
            {winProjectTemplateId ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="opportunity-win-project-name">
                    {t('opportunities.winDialog.projectName', 'Project name')}
                  </Label>
                  <Input
                    id="opportunity-win-project-name"
                    value={winProjectName}
                    onChange={(event) => setWinProjectName(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="opportunity-win-project-status">
                    {t('opportunities.winDialog.projectStatus', 'Initial status')}
                  </Label>
                  <CustomSelect
                    id="opportunity-win-project-status"
                    value={winProjectStatusId}
                    onValueChange={setWinProjectStatusId}
                    options={projectStatuses.map((status) => ({
                      value: status.status_id,
                      label: status.name,
                    }))}
                  />
                </div>
                <div>
                  <Label htmlFor="opportunity-win-project-start">
                    {t('opportunities.winDialog.projectStart', 'Start date')}
                  </Label>
                  <Input
                    id="opportunity-win-project-start"
                    type="date"
                    value={winProjectStartDate}
                    onChange={(event) => setWinProjectStartDate(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button id="opportunity-win-cancel" variant="ghost" size="sm" onClick={() => setWinOpen(false)} disabled={winning}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              id="opportunity-win-confirm"
              size="sm"
              disabled={winning || Boolean(winProjectTemplateId && !winProjectName.trim())}
              onClick={async () => {
                setWinning(true);
                try {
                  await run(
                    () => winOpportunity(detail.opportunity_id, winProjectTemplateId ? {
                      project_template_id: winProjectTemplateId,
                      project_name: winProjectName.trim(),
                      project_status_id: winProjectStatusId || undefined,
                      project_start_date: winProjectStartDate || undefined,
                    } : {}),
                    t('opportunities.toast.won', 'Won'),
                  );
                  setWinOpen(false);
                } finally {
                  setWinning(false);
                }
              }}
            >
              {t('opportunities.winDialog.confirm', 'Mark won')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
