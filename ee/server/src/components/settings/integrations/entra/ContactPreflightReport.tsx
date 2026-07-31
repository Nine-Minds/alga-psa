'use client';

import React from 'react';
import { Eye } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Progress } from '@alga-psa/ui/components/Progress';
import { EntraSection } from './EntraSection';
import { RelativeTime } from './RelativeTime';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  EntraPreflightBucketId,
  EntraPreflightIdentity,
  EntraPreflightResponse,
} from '@alga-psa/integrations/actions';

interface ContactPreflightReportProps {
  report: EntraPreflightResponse;
  /** Re-run the preflight. Omitted where the report is not the caller's to refresh. */
  onRecheck?: () => void;
  rechecking?: boolean;
}

/** Read order: what will be created first, then what needs a person. */
const BUCKET_ORDER: EntraPreflightBucketId[] = [
  'create',
  'link',
  'needs_decision',
  'mark_inactive',
  'no_change',
];

const BUCKET_LABEL_KEYS: Record<EntraPreflightBucketId, string> = {
  create: 'integrations.entra.preflight.buckets.create.label',
  link: 'integrations.entra.preflight.buckets.link.label',
  needs_decision: 'integrations.entra.preflight.buckets.needsDecision.label',
  mark_inactive: 'integrations.entra.preflight.buckets.markInactive.label',
  no_change: 'integrations.entra.preflight.buckets.noChange.label',
};

const BUCKET_DESCRIPTION_KEYS: Record<EntraPreflightBucketId, string> = {
  create: 'integrations.entra.preflight.buckets.create.description',
  link: 'integrations.entra.preflight.buckets.link.description',
  needs_decision: 'integrations.entra.preflight.buckets.needsDecision.description',
  mark_inactive: 'integrations.entra.preflight.buckets.markInactive.description',
  no_change: 'integrations.entra.preflight.buckets.noChange.description',
};

/**
 * Colour carries the same meaning it does everywhere else in the product:
 * green creates, blue links, amber needs a person, red takes something away.
 */
const BUCKET_BAR_CLASSES: Record<EntraPreflightBucketId, string> = {
  create: 'bg-success',
  link: 'bg-primary-500',
  needs_decision: 'bg-warning',
  mark_inactive: 'bg-destructive',
  no_change: 'bg-muted-foreground/40',
};

const BUCKET_DOT_CLASSES: Record<EntraPreflightBucketId, string> = BUCKET_BAR_CLASSES;

function identityLabel(identity: EntraPreflightIdentity): string {
  return (
    identity.displayName
    || identity.email
    || identity.userPrincipalName
    || identity.entraObjectId
  );
}

/**
 * What the sync would do, before it does it.
 *
 * The proportions are the point: "109 linked, 29 created, 4 to decide" is a
 * normal first run, and "0 linked, 1,842 created" is a mapping mistake about to
 * duplicate someone's whole contact list — and those two read differently at a
 * glance only if the counts are drawn as counts. Every bucket expands to the
 * identities behind the number, because "12 contacts will be created" is a
 * claim an operator has to be able to check against their own directory.
 */
export function ContactPreflightReport({
  report,
  onRecheck,
  rechecking = false,
}: ContactPreflightReportProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [expanded, setExpanded] = React.useState<EntraPreflightBucketId | null>(null);

  const bucketsById = new Map(report.buckets.map((bucket) => [bucket.bucket, bucket]));
  const total = Math.max(
    report.totalIdentities || 0,
    report.buckets.reduce((sum, bucket) => sum + (bucket.count || 0), 0)
  );

  return (
    <EntraSection
      id="entra-preflight-report"
      icon={Eye}
      title={t('integrations.entra.preflight.title')}
      description={
        <span className="flex flex-wrap items-center gap-x-1.5">
          {t('integrations.entra.preflight.summaryNoTime', { count: report.totalIdentities })}
          {/* A preview is cached until this client syncs, so it can be much
              older than the panel opening suggests. The age is the whole point
              of showing it, which an absolute timestamp buried in the sentence
              was not doing. */}
          <span id="entra-preflight-age" className="inline-flex items-center gap-1">
            {t('integrations.entra.preflight.checkedLabel')}
            <RelativeTime value={report.checkedAt} fallback={null} />
          </span>
        </span>
      }
      action={
        <div className="flex flex-shrink-0 items-center gap-2">
          <Badge variant="default-muted" id="entra-preflight-nothing-written">
            {t('integrations.entra.preflight.nothingWritten')}
          </Badge>
          {onRecheck ? (
            <Button
              id="entra-preflight-recheck"
              type="button"
              size="xs"
              variant="outline"
              onClick={onRecheck}
              disabled={rechecking}
            >
              {rechecking
                ? t('integrations.entra.pilot.actions.previewing')
                : t('integrations.entra.preflight.checkAgain')}
            </Button>
          ) : null}
        </div>
      }
    >

      <div className="mt-4 space-y-2">
        {BUCKET_ORDER.map((bucketId) => {
          const bucket = bucketsById.get(bucketId);
          const count = bucket?.count ?? 0;
          const samples = bucket?.samples ?? [];
          const isExpanded = expanded === bucketId;
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;

          return (
            <div key={bucketId} id={`entra-preflight-bucket-${bucketId}`}>
              <div className="flex items-center gap-3">
                <span className="flex w-52 min-w-0 flex-shrink-0 items-center gap-2 text-sm">
                  <span
                    className={`h-2.5 w-2.5 flex-shrink-0 rounded-sm ${BUCKET_DOT_CLASSES[bucketId]}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{t(BUCKET_LABEL_KEYS[bucketId])}</span>
                </span>
                <Progress
                  value={percent}
                  className="h-2 flex-1"
                  indicatorClassName={BUCKET_BAR_CLASSES[bucketId]}
                  aria-label={t(BUCKET_LABEL_KEYS[bucketId])}
                />
                <span
                  className="w-12 flex-shrink-0 text-right text-sm font-semibold tabular-nums"
                  data-bucket-count={count}
                >
                  {count}
                </span>
                {/* w-24 was a pixel short of "Show names" at this size, so every
                    row with a count wrapped its own button onto two lines. */}
                <span className="w-28 flex-shrink-0 text-right">
                  {count > 0 ? (
                    <Button
                      id={`entra-preflight-expand-${bucketId}`}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="whitespace-nowrap"
                      onClick={() => setExpanded(isExpanded ? null : bucketId)}
                    >
                      {isExpanded
                        ? t('integrations.entra.preflight.hideNames')
                        : t('integrations.entra.preflight.showNames')}
                    </Button>
                  ) : null}
                </span>
              </div>

              {isExpanded ? (
                <div className="mt-1 rounded-md border border-border/50 bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">
                    {t(BUCKET_DESCRIPTION_KEYS[bucketId])}
                  </p>
                  {samples.length > 0 ? (
                    <ul
                      className="mt-2 flex flex-wrap gap-x-4 gap-y-1"
                      id={`entra-preflight-samples-${bucketId}`}
                    >
                      {samples.map((identity) => (
                        <li key={identity.entraObjectId} className="min-w-0 truncate text-sm">
                          {identityLabel(identity)}
                          {identity.email && identity.email !== identityLabel(identity)
                            ? ` · ${identity.email}`
                            : ''}
                        </li>
                      ))}
                      {count > samples.length ? (
                        <li className="text-sm text-muted-foreground">
                          {t('integrations.entra.preflight.moreNames', {
                            count: count - samples.length,
                          })}
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </EntraSection>
  );
}

export default ContactPreflightReport;
