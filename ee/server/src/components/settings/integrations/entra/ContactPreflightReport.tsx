'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  EntraPreflightBucketId,
  EntraPreflightIdentity,
  EntraPreflightResponse,
} from '@alga-psa/integrations/actions';

interface ContactPreflightReportProps {
  report: EntraPreflightResponse;
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

function identityLabel(identity: EntraPreflightIdentity): string {
  return (
    identity.displayName
    || identity.email
    || identity.userPrincipalName
    || identity.entraObjectId
  );
}

/**
 * What the sync would do, before it does it. Every bucket is expandable to the
 * identities behind the number, because "12 contacts will be created" is a
 * claim an operator has to be able to check against their own directory.
 */
export function ContactPreflightReport({ report }: ContactPreflightReportProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [expanded, setExpanded] = React.useState<EntraPreflightBucketId | null>(null);

  const bucketsById = new Map(report.buckets.map((bucket) => [bucket.bucket, bucket]));

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-background p-4" id="entra-preflight-report">
      <div>
        <p className="text-sm font-semibold">{t('integrations.entra.preflight.title')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('integrations.entra.preflight.summary', {
            count: report.totalIdentities,
            time: new Date(report.checkedAt).toLocaleString(),
          })}
        </p>
      </div>

      <ul className="divide-y divide-border/60">
        {BUCKET_ORDER.map((bucketId) => {
          const bucket = bucketsById.get(bucketId);
          const count = bucket?.count ?? 0;
          const samples = bucket?.samples ?? [];
          const isExpanded = expanded === bucketId;

          return (
            <li key={bucketId} className="py-2" id={`entra-preflight-bucket-${bucketId}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(BUCKET_LABEL_KEYS[bucketId])}</p>
                  <p className="text-sm text-muted-foreground">
                    {t(BUCKET_DESCRIPTION_KEYS[bucketId])}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold" data-bucket-count={count}>
                    {count}
                  </span>
                  {count > 0 ? (
                    <Button
                      id={`entra-preflight-expand-${bucketId}`}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(isExpanded ? null : bucketId)}
                    >
                      {isExpanded
                        ? t('integrations.entra.preflight.hideNames')
                        : t('integrations.entra.preflight.showNames')}
                    </Button>
                  ) : null}
                </div>
              </div>

              {isExpanded && samples.length > 0 ? (
                <ul
                  className="mt-2 list-disc space-y-0.5 pl-4"
                  id={`entra-preflight-samples-${bucketId}`}
                >
                  {samples.map((identity) => (
                    <li key={identity.entraObjectId} className="min-w-0 truncate text-sm text-muted-foreground">
                      {identityLabel(identity)}
                      {identity.email && identity.email !== identityLabel(identity)
                        ? ` · ${identity.email}`
                        : ''}
                    </li>
                  ))}
                  {count > samples.length ? (
                    <li className="text-sm text-muted-foreground">
                      {t('integrations.entra.preflight.moreNames', { count: count - samples.length })}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ContactPreflightReport;
