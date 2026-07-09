import React from 'react';
import { cache } from 'react';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { getCurrentUser, getCurrentUserPermissions } from '@alga-psa/user-composition/actions';
import { Suspense } from 'react';
import { TicketDetailsSkeleton } from '@alga-psa/tickets/components/ticket/TicketDetailsSkeleton';
import { getSurveyTicketSummary } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import AssociatedAssets from '@alga-psa/assets/components/AssociatedAssets';
import MspTicketDetailsContainerClient from '@alga-psa/msp-composition/tickets/MspTicketDetailsContainerClient';

import { getTicketById } from '@alga-psa/tickets/actions/ticketActions';
import { getTicketTimelineEntries } from '@alga-psa/tickets/actions/ticketActivityActions';
import { getCommentsReactionsBatch } from '@alga-psa/tickets/actions/comment-actions/commentReactionActions';
import {
  getTicketBillingRollup,
  getTicketInteractions,
  getTicketScheduleEntries,
  getTicketSlaPolicyName,
} from '@alga-psa/tickets/actions/ticketBentoActions';
import { getTicketLayoutPreference } from '@alga-psa/tickets/actions/ticketLayoutPreference';
import { getTicketChecklistItems } from '@alga-psa/tickets/actions/checklists/ticketChecklistActions';
import { getTicketAutoCloseState } from '@alga-psa/tickets/actions/close-rules/closeRuleActions';
import { getTicketingDisplaySettings } from '@alga-psa/tickets/actions/ticketDisplaySettings';
import { listTicketMaterials } from '@alga-psa/tickets/actions/materialCatalogActions';
import { hasAdminSettingsViewAccess } from '@alga-psa/tickets/components/ticket/commentMetadataDebug';
import type { TicketScreenBootstrap } from '@alga-psa/tickets/lib/ticketScreenBootstrap';
import { getAdjacentTicketIds } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { parseReturnFilters, DEFAULT_TICKET_LIST_FILTERS } from '@alga-psa/tickets/lib/ticketFilterUtils';
import { listEntityAssets } from '@alga-psa/assets/actions/assetActions';
import { unwrapAssetActionResult } from '@alga-psa/assets/actions/assetActionErrors';
import { getLinkedTasksForTicketAction } from '@alga-psa/projects/actions/projectTaskActions';
import { findTagsByEntityId, isTagActionError } from '@alga-psa/tags/actions';
import { getTeams, isTeamActionError } from '@alga-psa/teams/actions';
import { fetchTimeEntriesForTicket } from '@alga-psa/scheduling/actions/timeEntryTicketActions';
import { AIChatContextBoundary } from '@product/chat/context';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

const getCachedTicket = cache((id: string) => getTicketById(id));

function getActionErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as { actionError?: unknown; permissionError?: unknown };
  if (typeof candidate.permissionError === 'string') {
    return candidate.permissionError;
  }
  if (typeof candidate.actionError === 'string') {
    return candidate.actionError;
  }
  return null;
}

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return getActionErrorMessage(value) !== null;
}

export async function generateMetadata({ params }: TicketDetailsPageProps): Promise<Metadata> {
  try {
    const { id } = await params;
    const ticket = await getCachedTicket(id);
    if (ticket && 'ticket_number' in ticket) {
      return { title: `Ticket #${ticket.ticket_number} - ${ticket.title}` };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch ticket title:', error);
  }
  return { title: 'Ticket Details' };
}

interface TicketDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TicketDetailsPage({ params, searchParams }: TicketDetailsPageProps) {
  const resolvedParams = await params;
  const { id } = resolvedParams;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const returnFiltersParam = typeof resolvedSearchParams.returnFilters === 'string'
    ? resolvedSearchParams.returnFilters
    : null;
  const productCode = await getCurrentTenantProduct();
  const isAlgaDesk = productCode === 'algadesk';
  
  // Get current user for authorization
  const user = await getCurrentUser();
  if (!user) {
    const { t } = await getServerTranslation(undefined, 'common');
    return <div id="ticket-error-message">{t('pages.errors.userNotAuthenticatedError')}</div>;
  }

  try {
    // Everything the first paint needs, gathered in ONE parallel batch so the
    // client renders without any fetch-on-mount requests.
    const [
      ticketData,
      surveySummary,
      layoutPreference,
      checklistItems,
      autoCloseState,
      permissions,
      teams,
      displaySettings,
      tags,
    ] = await Promise.all([
      getConsolidatedTicketData(id),
      (isAlgaDesk ? Promise.resolve(null) : getSurveyTicketSummary(id)).catch((error) => {
        console.error('[TicketDetailsPage] Failed to load survey summary', error);
        return null;
      }),
      getTicketLayoutPreference().catch(() => null),
      getTicketChecklistItems(id).catch(() => null),
      getTicketAutoCloseState(id).catch(() => null),
      getCurrentUserPermissions().catch(() => null),
      getTeams().catch(() => null),
      getTicketingDisplaySettings().catch(() => null),
      findTagsByEntityId(id, 'ticket').catch(() => null),
    ]);

    const ticketDataError = getActionErrorMessage(ticketData);
    if (ticketDataError) {
      return <div id="ticket-error-message">{ticketDataError}</div>;
    }
    const safeLayoutPreference = isReturnedActionError(layoutPreference) ? null : layoutPreference;
    const safeTeams = isTeamActionError(teams) ? null : teams;
    const safeTags = isTagActionError(tags) ? [] : tags;
    if (isTagActionError(tags)) {
      console.error('[TicketDetailsPage] Failed to load tags:', tags);
    }

    // Slower per-tile queries are STARTED here but not awaited: the promises
    // stream to the client where each tile resolves its own via React `use()`
    // behind a <Suspense> skeleton. Rejections are normalized server-side so a
    // failed tile degrades to its empty state instead of an error boundary.
    const commentIds = (ticketData.comments ?? [])
      .map((comment: { comment_id?: string | null }) => comment.comment_id)
      .filter((commentId: string | null | undefined): commentId is string => Boolean(commentId));
    const bootstrap: TicketScreenBootstrap = {
      layoutPreference: safeLayoutPreference,
      checklistItems,
      autoCloseState,
      canViewCommentMetadataDebug: permissions ? hasAdminSettingsViewAccess(permissions) : null,
      teams: safeTeams,
      displaySettings,
      tags: safeTags,
      streams: {
        timelineEntries: getTicketTimelineEntries(id, {
          order: 'asc',
          includeTimeEntries: true,
          includeAlerts: true,
        })
          .then((entries) => isReturnedActionError(entries) ? [] : entries.filter((entry) => entry.type !== 'comment'))
          .catch(() => []),
        commentReactions: (commentIds.length
          ? getCommentsReactionsBatch(commentIds)
          : Promise.resolve({ reactions: {}, userNames: {} })
        ).catch(() => ({ reactions: {}, userNames: {} })),
        scheduleEntries: getTicketScheduleEntries(id)
          .then((entries) => isReturnedActionError(entries) ? [] : entries)
          .catch(() => []),
        interactions: getTicketInteractions(id, { limit: 5 })
          .then((interactions) => isReturnedActionError(interactions) ? [] : interactions)
          .catch(() => []),
        billingRollup: getTicketBillingRollup(id)
          .then((rollup) => isReturnedActionError(rollup) ? null : rollup)
          .catch(() => null),
        slaPolicyName: (ticketData.ticket?.sla_policy_id
          ? getTicketSlaPolicyName(id).then((result) => isReturnedActionError(result) ? null : result.policyName ?? null)
          : Promise.resolve(null)
        ).catch(() => null),
        timeEntries: fetchTimeEntriesForTicket(id).catch(() => null),
        materials: listTicketMaterials(id).catch(() => []),
        adjacentTickets: getAdjacentTicketIds(
          id,
          returnFiltersParam ? parseReturnFilters(returnFiltersParam) : DEFAULT_TICKET_LIST_FILTERS,
        ).catch(() => null),
      },
    };

    // Streams consumed OUTSIDE the TicketDetails tree (page-level slots).
    const associatedAssetsStream = listEntityAssets(id, 'ticket').then(unwrapAssetActionResult).catch(() => []);
    const linkedTasksStream = isAlgaDesk ? undefined : getLinkedTasksForTicketAction(id).catch(() => []);

    const associatedAssets =
      !isAlgaDesk && ticketData.ticket?.client_id && ticketData.ticket?.ticket_id ? (
        <Suspense fallback={<div id="associated-assets-skeleton" className="animate-pulse bg-gray-200 h-32 rounded-lg"></div>}>
          <AssociatedAssets
            id="ticket-details-associated-assets"
            entityId={ticketData.ticket.ticket_id}
            entityType="ticket"
            clientId={ticketData.ticket.client_id}
            defaultBoardId={ticketData.ticket.board_id}
            initialAssets={associatedAssetsStream}
          />
        </Suspense>
      ) : null;
    
    const detailsContent = (
      <div id="ticket-details-container" className="bg-gray-100">
        <Suspense fallback={<TicketDetailsSkeleton />}>
          <MspTicketDetailsContainerClient
            ticketData={ticketData as any}
            surveySummary={surveySummary ?? null}
            associatedAssets={associatedAssets}
            isAlgaDeskMode={isAlgaDesk}
            bootstrap={bootstrap}
            linkedTasksStream={linkedTasksStream}
          />
        </Suspense>
      </div>
    );

    return isAlgaDesk ? detailsContent : (
      <AIChatContextBoundary
        value={{
          pathname: `/msp/tickets/${id}`,
          screen: {
            key: 'tickets.detail',
            label: 'Ticket Details',
          },
          record: {
            type: 'ticket',
            id,
          },
        }}
      >
        {detailsContent}
      </AIChatContextBoundary>
    );
  } catch (error) {
    console.error(`Error fetching ticket with id ${id}:`, error);
    return (
      <div id="ticket-error-message">
        Error: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
}

export const dynamic = "force-dynamic";
