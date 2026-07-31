'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { BadgeVariant } from '@alga-psa/ui/components/Badge';
import type {
  MarketingCampaignStatus,
  MarketingEnrollmentState,
  MarketingSequenceStatus,
  SocialPostStatus,
  SocialPostTargetStatus,
} from '@alga-psa/types';

const POST_TARGET_VARIANTS: Record<SocialPostTargetStatus, BadgeVariant> = {
  scheduled: 'info',
  'awaiting-manual-publish': 'warning',
  published: 'success',
  skipped: 'default-muted',
  expired: 'default-muted',
};

const POST_STATUS_VARIANTS: Record<SocialPostStatus, BadgeVariant> = {
  draft: 'default-muted',
  scheduled: 'info',
  'awaiting-manual-publish': 'warning',
  published: 'success',
  expired: 'default-muted',
};

const CAMPAIGN_STATUS_VARIANTS: Record<MarketingCampaignStatus, BadgeVariant> = {
  draft: 'default-muted',
  active: 'success',
  completed: 'info',
  archived: 'default-muted',
};

const SEQUENCE_STATUS_VARIANTS: Record<MarketingSequenceStatus, BadgeVariant> = {
  draft: 'default-muted',
  active: 'success',
  paused: 'warning',
  archived: 'default-muted',
};

const ENROLLMENT_STATE_VARIANTS: Record<MarketingEnrollmentState, BadgeVariant> = {
  active: 'primary',
  completed: 'success',
  stopped: 'default-muted',
};

const LABELS: Record<string, string> = {
  'awaiting-manual-publish': 'awaiting publish',
};

function labelFor(status: string): string {
  return LABELS[status] ?? status;
}

export function PostTargetStatusBadge({ status }: { status: SocialPostTargetStatus }): React.ReactElement {
  return (
    <Badge variant={POST_TARGET_VARIANTS[status]} size="sm" className="whitespace-nowrap">
      {labelFor(status)}
    </Badge>
  );
}

export function PostStatusBadge({ status }: { status: SocialPostStatus }): React.ReactElement {
  return (
    <Badge variant={POST_STATUS_VARIANTS[status]} size="sm" className="whitespace-nowrap">
      {labelFor(status)}
    </Badge>
  );
}

export function CampaignStatusBadge({ status }: { status: MarketingCampaignStatus }): React.ReactElement {
  return (
    <Badge variant={CAMPAIGN_STATUS_VARIANTS[status]} size="sm" className="whitespace-nowrap">
      {labelFor(status)}
    </Badge>
  );
}

export function SequenceStatusBadge({ status }: { status: MarketingSequenceStatus }): React.ReactElement {
  return (
    <Badge variant={SEQUENCE_STATUS_VARIANTS[status]} size="sm" className="whitespace-nowrap">
      {labelFor(status)}
    </Badge>
  );
}

export function EnrollmentStateBadge({ state }: { state: MarketingEnrollmentState }): React.ReactElement {
  return (
    <Badge variant={ENROLLMENT_STATE_VARIANTS[state]} size="sm" className="whitespace-nowrap">
      {labelFor(state)}
    </Badge>
  );
}
