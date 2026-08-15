'use client';

/**
 * Generic entity "Passwords" section (EE-only, Pro tier, flag-gated).
 *
 * The per-entity section embed for credential attachments — the credentials
 * analog of documents' shared section (documents render through
 * Documents.tsx with `entityType`/`entityId` props). Every entity surface
 * (asset, ticket, contact, document, project task) renders this one component
 * scoped to its `(entityType, entityId)`.
 *
 * // LEVERAGE: pattern entity-attachments — documents (Documents.tsx +
 * // TicketDocumentsSection/ContactBentoLayout embeds) and credentials (this
 * // section + the per-surface wrappers) both mount an entity-scoped child
 * // panel that lists associations, creates pre-attached, links existing, and
 * // detaches. A shared entity-attachments engine is a follow-up card (plan
 * // §scope expansion, decision 2).
 *
 * The ENTIRE section — Card and header included — is gated on the
 * `release-v1.5-feature` flag: flag off renders nothing. Below-Pro tenants get
 * a one-line upgrade teaser in the card instead of the vault (the nav item
 * and client tab are hidden for them, so this is where they learn the feature
 * exists); the full FeatureUpgradeNotice stays on the global screen.
 */

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useContentCardVariant } from '@alga-psa/ui/components';
import { KeyRound, Lock } from 'lucide-react';
import { TIER_FEATURES } from '@alga-psa/types';
import { useTier } from 'server/src/context/TierContext';
import type { CredentialAssociationEntityType } from '../../lib/credentials/contracts';
import { CredentialsScreen } from './CredentialsScreen';

interface EntityCredentialsSectionProps {
  entityType: CredentialAssociationEntityType;
  entityId: string;
  /** Owning client of the entity (client-bound types): prefill + same-client
   *  link filter. Omit for clientless types. */
  defaultClientId?: string | null;
  /** Override the section title locale key (asset keeps its own key). */
  titleKey?: string;
}

/**
 * Card chrome that adapts to the surrounding ContentCardVariantProvider:
 * default contexts keep the standard Card, bento contexts (ticket Grid view)
 * get the compact tile shell so the section matches its sibling tiles.
 */
function SectionShell({
  id,
  title,
  isBento,
  children,
}: {
  id: string;
  title: React.ReactNode;
  isBento: boolean;
  children: React.ReactNode;
}) {
  if (isBento) {
    return (
      <div
        id={id}
        className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 space-y-3 min-w-0"
      >
        <h3 className="text-sm font-semibold text-[rgb(var(--color-text-800))] flex items-center gap-2 min-w-0">
          <KeyRound className="h-4 w-4 shrink-0" />
          {title}
        </h3>
        {children}
      </div>
    );
  }

  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 shrink-0" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EntityCredentialsSection({
  entityType,
  entityId,
  defaultClientId,
  titleKey = 'credentials.section.title',
}: EntityCredentialsSectionProps) {
  const { t } = useTranslation('msp/credentials');
  const releaseFlag = useFeatureFlag('release-v1.5-feature', { defaultValue: false });
  const flagEnabled = typeof releaseFlag === 'boolean' ? releaseFlag : releaseFlag?.enabled ?? false;
  const { hasFeature } = useTier();
  const isBento = useContentCardVariant() === 'bento';

  const cardId = `${entityType}-credentials-section`;
  const teaserId = `${entityType}-credentials-tier-teaser`;
  const viewPlansId = `${entityType}-credentials-view-plans`;

  if (!flagEnabled) {
    return null;
  }

  if (!hasFeature(TIER_FEATURES.CREDENTIALS)) {
    return (
      <SectionShell id={teaserId} title={t(titleKey)} isBento={isBento}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <Lock className="h-4 w-4 shrink-0" />
            {t('credentials.section.tierTeaser')}
          </p>
          <Link
            id={viewPlansId}
            href="/msp/account"
            className="text-sm font-medium text-[rgb(var(--color-primary-600))] hover:underline"
          >
            {t('credentials.section.viewPlans')}
          </Link>
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell id={cardId} title={t(titleKey)} isBento={isBento}>
      <CredentialsScreen entityType={entityType} entityId={entityId} defaultClientId={defaultClientId ?? null} />
    </SectionShell>
  );
}

export default EntityCredentialsSection;
