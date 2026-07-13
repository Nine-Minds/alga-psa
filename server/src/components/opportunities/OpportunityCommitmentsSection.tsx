'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IOpportunityCommitment, IOpportunityDetail } from '@alga-psa/types';
import {
  createOpportunityCommitment,
  listOpportunityCommitments,
  updateOpportunityCommitment,
} from '@enterprise/lib/opportunities/actions';

/**
 * The commitments ledger: every promise made during the courtship, each
 * resolved to something real before the deal can close won. Verbal promises
 * stop evaporating in the handoff.
 */
export function OpportunityCommitmentsSection({ detail }: { detail: IOpportunityDetail }) {
  const { t } = useTranslation();
  const [commitments, setCommitments] = useState<IOpportunityCommitment[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const open = detail.status === 'open';

  const load = useCallback(async () => {
    try {
      setCommitments(await listOpportunityCommitments(detail.opportunity_id));
    } catch {
      // Tier revoked mid-session: render nothing rather than erroring.
      setCommitments([]);
    }
  }, [detail.opportunity_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!description.trim()) return;
    setBusy(true);
    try {
      await createOpportunityCommitment(detail.opportunity_id, { description: description.trim() });
      setDescription('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (commitment: IOpportunityCommitment, value: string) => {
    try {
      if (value === 'declined') {
        await updateOpportunityCommitment(detail.opportunity_id, commitment.commitment_id, {
          resolution_status: 'declined',
        });
      } else if (value.startsWith('quote:')) {
        await updateOpportunityCommitment(detail.opportunity_id, commitment.commitment_id, {
          resolution_status: 'quote_line',
          resolution_ref_id: value.slice('quote:'.length),
        });
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const unresolved = commitments.filter((c) => c.resolution_status === 'open');

  const resolutionOptions = [
    ...detail.linked_quotes.map((q) => ({
      value: `quote:${q.quote_id}`,
      label: t('opportunities.commitments.coveredByQuote', 'Covered by {{quote}}', { quote: q.quote_number }),
    })),
    { value: 'declined', label: t('opportunities.commitments.declined', 'Declined — not happening') },
  ];

  return (
    <section
      id="opportunity-commitments"
      className="rounded-xl border border-[rgb(var(--color-border-200))] bg-white p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
          {t('opportunities.commitments.title', 'Commitments')}
        </h2>
        {unresolved.length > 0 ? (
          <Badge variant="warning" size="sm">
            {t('opportunities.commitments.openCount', '{{count}} unresolved — blocks close-won', {
              count: unresolved.length,
            })}
          </Badge>
        ) : null}
      </div>
      <p className="mb-3 text-[12px] text-[rgb(var(--color-text-400))]">
        {t(
          'opportunities.commitments.help',
          'Write down every promise as it leaves your mouth. Each one resolves to a quote line or gets declined before the deal closes.'
        )}
      </p>

      {commitments.length > 0 ? (
        <ul className="mb-3 space-y-2">
          {commitments.map((c) => (
            <li key={c.commitment_id} className="flex items-center gap-3 text-[13px]">
              <span
                className={`min-w-0 flex-1 ${
                  c.resolution_status === 'declined'
                    ? 'text-[rgb(var(--color-text-400))] line-through'
                    : 'text-[rgb(var(--color-text-700))]'
                }`}
              >
                {c.description}
              </span>
              {c.resolution_status === 'open' && open ? (
                <div className="w-56 flex-none">
                  <CustomSelect
                    id={`opportunity-commitment-resolve-${c.commitment_id}`}
                    options={resolutionOptions}
                    value=""
                    placeholder={t('opportunities.commitments.resolve', 'Resolve…')}
                    onValueChange={(v: string) => void resolve(c, v)}
                  />
                </div>
              ) : c.resolution_status !== 'open' ? (
                <Badge variant={c.resolution_status === 'declined' ? 'default-muted' : 'success'} size="sm">
                  {t(`opportunities.commitments.status.${c.resolution_status}`, c.resolution_status.replace('_', ' '))}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              id="opportunity-commitment-new"
              placeholder={t('opportunities.commitments.placeholder', 'e.g. Email migration included in onboarding')}
              value={description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
            />
          </div>
          <Button id="opportunity-commitment-add" size="sm" variant="soft" onClick={add} disabled={busy || !description.trim()}>
            {t('opportunities.commitments.add', 'Record it')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
