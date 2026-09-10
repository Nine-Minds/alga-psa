'use client';

/**
 * Generic entity "Passwords" section (EE-only, Pro tier).
 *
 * The per-entity section embed for credential attachments — the credentials
 * analog of documents' shared section (documents render through
 * Documents.tsx with `entityType`/`entityId` props). Every entity surface
 * (asset, ticket, contact, document, project task) renders this one component
 * scoped to its `(entityType, entityId)`.
 *
 * Two presentations, resolved from the surrounding ContentCardVariantProvider:
 * - default: a titled Card wrapping the entity-scoped CredentialsScreen
 *   (Entry view, asset detail — full-width surfaces).
 * - bento: a compact BentoTile (name · badges · reveal/copy per row, "+" in
 *   the header) with the full CredentialsScreen in a dialog — the
 *   DocumentsTile pattern, because the rail tile is ~250px wide.
 *
 * // LEVERAGE: pattern entity-attachments — documents (Documents.tsx +
 * // TicketDocumentsSection/ContactBentoLayout embeds) and credentials (this
 * // section + the per-surface wrappers) both mount an entity-scoped child
 * // panel that lists associations, creates pre-attached, links existing, and
 * // detaches — and both now grow a compact-tile + manager-dialog split. A
 * // shared entity-attachments engine is a follow-up card (plan §scope
 * // expansion, decision 2).
 *
 * Below-Pro tenants get a one-line upgrade teaser instead of the vault (the
 * nav item and client tab are hidden for them, so this is where they learn
 * the feature exists); the full FeatureUpgradeNotice stays on the global
 * screen.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ContentCardVariantProvider, useContentCardVariant } from '@alga-psa/ui/components';
import {
  BentoMicroBadge,
  BentoRow,
  BentoRowList,
  BentoTile,
  BentoTileEmpty,
  BentoTileEmptyAction,
  TileSkeleton,
} from '@alga-psa/ui/components/bento';
import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Lock, Plus } from 'lucide-react';
import { TIER_FEATURES } from '@alga-psa/types';
import { useTier } from 'server/src/context/TierContext';
import type { CredentialAssociationEntityType, CredentialSummary } from '../../lib/credentials/contracts';
import { CredentialsScreen } from './CredentialsScreen';
import { TotpCountdown } from './TotpCountdown';
import { useCredentialsList, type RevealErrorKey } from './useCredentialsList';

/** Rows shown in the rail tile before the list overflows into "View all". */
const MAX_TILE_ROWS = 5;

interface EntityCredentialsSectionProps {
  entityType: CredentialAssociationEntityType;
  entityId: string;
  /** Owning client of the entity (client-bound types): prefill + same-client
   *  link filter. Omit for clientless types. */
  defaultClientId?: string | null;
  /** Override the section title locale key (asset keeps its own key). */
  titleKey?: string;
}

type CredentialsListState = ReturnType<typeof useCredentialsList>;

function CredentialTileRow({
  tileId,
  item,
  list,
  t,
}: {
  tileId: string;
  item: CredentialSummary;
  list: CredentialsListState;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const rowId = `${tileId}-row-${item.id}`;
  const revealed = list.revealedValues[item.id];
  const errorKey = list.revealErrors[item.id];
  const busy = list.revealingIds[item.id] === true;
  const revealErrorText: Record<RevealErrorKey, string> = {
    failed: t('credentials.table.revealFailed'),
    noAccess: t('credentials.table.revealNoAccess'),
    notFound: t('credentials.table.revealNotFound'),
  };
  const toggleLabel = revealed
    ? t('credentials.section.hidePassword')
    : t('credentials.section.showPassword');

  return (
    <BentoRow id={rowId} stacked>
      <div className="flex items-center gap-2 min-w-0">
        <span
          id={`${rowId}-name`}
          className="min-w-0 truncate text-[rgb(var(--color-text-700))]"
          title={item.name}
        >
          {item.name}
        </span>
        {item.source === 'hudu' && (
          <BentoMicroBadge id={`${rowId}-source`}>{t('credentials.screen.sourceHudu')}</BentoMicroBadge>
        )}
        {item.hasOtp && (
          <BentoMicroBadge id={`${rowId}-totp`}>{t('credentials.table.totp')}</BentoMicroBadge>
        )}
        {item.isRestricted && (
          <Lock
            className="h-3 w-3 flex-shrink-0 text-[rgb(var(--color-text-400))]"
            aria-label={t('credentials.table.restrictedOn')}
          />
        )}
        <span className="ml-auto flex items-center gap-1 flex-shrink-0">
          {item.externalUrl && (
            <a
              id={`${rowId}-open`}
              href={item.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-6 w-6 items-center justify-center text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-primary-600))]"
              aria-label={t('credentials.table.openUrl')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <Button
            id={`${rowId}-reveal`}
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            disabled={busy}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={() => (revealed ? list.hide(item.id) : void list.reveal(item.id))}
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            id={`${rowId}-copy`}
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            disabled={busy}
            aria-label={t('credentials.section.copyPassword')}
            title={t('credentials.section.copyPassword')}
            onClick={() => void list.copyPassword(item.id)}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>
      {item.username && (
        <div id={`${rowId}-username`} className="text-xs text-[rgb(var(--color-text-500))] truncate">
          {item.username}
        </div>
      )}
      {revealed && (revealed.password !== '' || revealed.otpCode) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {revealed.password !== '' && (
            <code
              id={`${rowId}-value`}
              className="rounded bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 font-mono text-xs text-[rgb(var(--color-text-900))] break-all"
            >
              {revealed.password}
            </code>
          )}
          {revealed.otpCode && (
            <TotpCountdown
              credentialId={item.id}
              initial={{
                code: revealed.otpCode.code,
                secondsRemaining: revealed.otpCode.secondsRemaining,
              }}
              onCopyCode={() => list.copyOtp(item.id)}
            />
          )}
        </div>
      )}
      {errorKey && (
        <span id={`${rowId}-reveal-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {revealErrorText[errorKey]}
        </span>
      )}
    </BentoRow>
  );
}

/**
 * Compact rail-tile presentation: the 30-second loop (see rows, reveal/copy)
 * lives in the tile; everything heavier (create, link, detach) is one "+"
 * away in a dialog hosting the full entity-scoped CredentialsScreen.
 */
function CredentialsTile({
  entityType,
  entityId,
  defaultClientId,
  title,
}: {
  entityType: CredentialAssociationEntityType;
  entityId: string;
  defaultClientId?: string | null;
  title: string;
}) {
  const { t } = useTranslation('msp/credentials');
  const [managerOpen, setManagerOpen] = useState(false);
  const list = useCredentialsList({ enabled: true, entityType, entityId });

  const tileId = `${entityType}-credentials-section`;
  const rows = list.credentials ?? [];
  const visible = rows.slice(0, MAX_TILE_ROWS);
  const overflow = rows.length - visible.length;

  const closeManager = () => {
    setManagerOpen(false);
    // Pick up links/creates/detaches made in the dialog.
    list.refresh();
  };

  let body: React.ReactNode;
  if (list.isLoading) {
    body = <TileSkeleton id={`${tileId}-loading`} />;
  } else if (list.loadError) {
    body = (
      <div id={`${tileId}-error`} className="text-sm text-[rgb(var(--color-text-500))]">
        {t('credentials.screen.error')}{' '}
        <button
          id={`${tileId}-retry`}
          type="button"
          onClick={() => list.refresh()}
          className="font-medium text-[rgb(var(--color-primary-600))] hover:underline"
        >
          {t('credentials.section.retry')}
        </button>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div>
        <BentoTileEmpty id={`${tileId}-empty`}>{t('credentials.section.empty')}</BentoTileEmpty>
        <BentoTileEmptyAction id={`${tileId}-attach-link`} onClick={() => setManagerOpen(true)}>
          {t('credentials.section.attach')}
        </BentoTileEmptyAction>
      </div>
    );
  } else {
    body = (
      <div>
        <BentoRowList>
          {visible.map((item) => (
            <CredentialTileRow key={item.id} tileId={tileId} item={item} list={list} t={t} />
          ))}
        </BentoRowList>
        {overflow > 0 && (
          <button
            id={`${tileId}-view-all`}
            type="button"
            onClick={() => setManagerOpen(true)}
            className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline mt-2"
          >
            {t('credentials.section.viewAllCount', { count: rows.length })}
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <BentoTile
        id={tileId}
        title={title}
        icon={<KeyRound className="h-4 w-4" />}
        action={
          <Button
            id={`${tileId}-manage-btn`}
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label={t('credentials.section.manage')}
            title={t('credentials.section.manage')}
            onClick={() => setManagerOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        }
      >
        {body}
      </BentoTile>

      <Dialog
        id={`${tileId}-manager-dialog`}
        isOpen={managerOpen}
        onClose={closeManager}
        title={title}
        // min-h matters: nested dialogs (attach picker, create form) render
        // confined to this panel's bounds, so a short manager would squeeze
        // them into an unusable sliver.
        className="max-w-3xl min-h-[28rem]"
      >
        {/* Reset the bento variant: inside the dialog the full entity screen
            has room and should render in its standard shape. */}
        <ContentCardVariantProvider variant="default">
          <CredentialsScreen
            entityType={entityType}
            entityId={entityId}
            defaultClientId={defaultClientId ?? null}
          />
        </ContentCardVariantProvider>
      </Dialog>
    </>
  );
}

export function EntityCredentialsSection({
  entityType,
  entityId,
  defaultClientId,
  titleKey = 'credentials.section.title',
}: EntityCredentialsSectionProps) {
  const { t } = useTranslation('msp/credentials');
  const { hasFeature } = useTier();
  const isBento = useContentCardVariant() === 'bento';

  const cardId = `${entityType}-credentials-section`;
  const teaserId = `${entityType}-credentials-tier-teaser`;
  const viewPlansId = `${entityType}-credentials-view-plans`;

  if (!hasFeature(TIER_FEATURES.CREDENTIALS)) {
    const teaserBody = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-500))]">
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
    );
    if (isBento) {
      return (
        <BentoTile id={teaserId} title={t(titleKey)} icon={<KeyRound className="h-4 w-4" />}>
          {teaserBody}
        </BentoTile>
      );
    }
    return (
      <Card id={teaserId}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 shrink-0" />
            {t(titleKey)}
          </CardTitle>
        </CardHeader>
        <CardContent>{teaserBody}</CardContent>
      </Card>
    );
  }

  if (isBento) {
    return (
      <CredentialsTile
        entityType={entityType}
        entityId={entityId}
        defaultClientId={defaultClientId}
        title={t(titleKey)}
      />
    );
  }

  return (
    <Card id={cardId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 shrink-0" />
          {t(titleKey)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CredentialsScreen entityType={entityType} entityId={entityId} defaultClientId={defaultClientId ?? null} />
      </CardContent>
    </Card>
  );
}

export default EntityCredentialsSection;
