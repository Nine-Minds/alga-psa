'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  IOpportunityDetail,
  IOpportunityFollowUpDraft,
  OpportunityConfidence,
  OpportunityLossReason,
} from '@alga-psa/types';
import {
  completeNextAction,
  declareQualified,
  loseOpportunity,
  updateOpportunity,
  winOpportunity,
} from '../../actions/opportunityActions';
import { OpportunityDetailView } from './OpportunityDetailView';
import { OpportunityTimelinePanel } from './OpportunityTimelinePanel';
import { CompleteActionDialog } from '../dialogs/CompleteActionDialog';
import { LoseOpportunityDialog } from '../dialogs/LoseOpportunityDialog';
import { EditValuesDialog } from '../dialogs/EditValuesDialog';
import { DraftEditorDialog } from '../dialogs/DraftEditorDialog';

export interface OpportunityDraftingCallbacks {
  generate: (opportunityId: string, toneAdjustment?: string) => Promise<IOpportunityFollowUpDraft>;
  logSent: (opportunityId: string, input: { subject: string; summary: string }) => Promise<void>;
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
  const [winning, setWinning] = useState(false);
  const [valuesOpen, setValuesOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(Boolean(drafting && autoOpenDraft));

  const refresh = () => router.refresh();

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
        timeline={<OpportunityTimelinePanel opportunityId={detail.opportunity_id} />}
        commitments={commitments}
        onEditValues={() => setValuesOpen(true)}
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
        onCreateQuote={() => router.push('/msp/billing?tab=quotes')}
        onOpenQuote={() => router.push('/msp/billing?tab=quotes')}
      />

      {drafting ? (
        <DraftEditorDialog
          isOpen={draftOpen}
          onClose={() => setDraftOpen(false)}
          onGenerate={(tone) => drafting.generate(detail.opportunity_id, tone)}
          onLogSent={async (input) => {
            await drafting.logSent(detail.opportunity_id, input);
            refresh();
          }}
        />
      ) : null}
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
          <div className="flex justify-end gap-2">
            <Button id="opportunity-win-cancel" variant="ghost" size="sm" onClick={() => setWinOpen(false)} disabled={winning}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              id="opportunity-win-confirm"
              size="sm"
              disabled={winning}
              onClick={async () => {
                setWinning(true);
                try {
                  await run(() => winOpportunity(detail.opportunity_id), t('opportunities.toast.won', 'Won'));
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
