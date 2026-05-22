'use client';

import React, { useEffect, useState, useCallback, useContext } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { UnsavedChangesContext } from '@alga-psa/ui/context/UnsavedChangesContext';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCatalogShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { getAdjacentTicketIds } from '../../actions/optimizedTicketActions';
import { parseReturnFilters, DEFAULT_TICKET_LIST_FILTERS } from '../../lib/ticketFilterUtils';

interface TicketNavigationProps {
  currentTicketId: string;
}

export default function TicketNavigation({ currentTicketId }: TicketNavigationProps) {
  const { t } = useTranslation('features/tickets');
  const searchParams = useSearchParams();
  const unsavedChangesContext = useContext(UnsavedChangesContext);

  const [adjacentData, setAdjacentData] = useState<{
    prevTicketId: string | null;
    nextTicketId: string | null;
    prevTicketNumber: string | null;
    nextTicketNumber: string | null;
    currentPosition: number;
    totalCount: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const returnFilters = searchParams?.get('returnFilters') ?? null;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const filters = returnFilters
      ? parseReturnFilters(returnFilters)
      : DEFAULT_TICKET_LIST_FILTERS;

    getAdjacentTicketIds(currentTicketId, filters)
      .then((data) => {
        if (!cancelled) {
          setAdjacentData(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('[TicketNavigation] Failed to fetch adjacent tickets:', err);
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [currentTicketId, returnFilters]);

  const navigateToTicket = useCallback((ticketId: string) => {
    const href = returnFilters
      ? `/msp/tickets/${ticketId}?returnFilters=${returnFilters}`
      : `/msp/tickets/${ticketId}`;

    const doNavigate = () => {
      window.location.href = href;
    };

    if (unsavedChangesContext) {
      unsavedChangesContext.confirmNavigation(doNavigate);
    } else {
      doNavigate();
    }
  }, [returnFilters, unsavedChangesContext]);

  const previousRecordShortcut = useCallback(() => {
      if (!adjacentData?.prevTicketId) {
        return false;
      }
      navigateToTicket(adjacentData.prevTicketId);
  }, [adjacentData?.prevTicketId, navigateToTicket]);
  const nextRecordShortcut = useCallback(() => {
      if (!adjacentData?.nextTicketId) {
        return false;
      }
      navigateToTicket(adjacentData.nextTicketId);
  }, [adjacentData?.nextTicketId, navigateToTicket]);

  useCatalogShortcut('record.previous', previousRecordShortcut, { enabled: Boolean(adjacentData?.prevTicketId) });
  useCatalogShortcut('record.next', nextRecordShortcut, { enabled: Boolean(adjacentData?.nextTicketId) });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1">
        <div className="h-7 w-7 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
        <span className="text-xs text-gray-400 px-1">...</span>
        <div className="h-7 w-7 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (!adjacentData || adjacentData.currentPosition === 0) return null;

  return (
    <div id="ticket-prev-next-navigation" className="flex items-center gap-1">
      <Button
        id="ticket-nav-prev"
        variant="outline"
        size="xs"
        disabled={!adjacentData.prevTicketId}
        onClick={() => adjacentData.prevTicketId && navigateToTicket(adjacentData.prevTicketId)}
        className="h-5 w-5 p-0"
        aria-label={t('navigation.previousTicket', 'Previous ticket')}
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>

      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap px-1">
        {adjacentData.currentPosition} / {adjacentData.totalCount}
      </span>

      <Button
        id="ticket-nav-next"
        variant="outline"
        size="xs"
        disabled={!adjacentData.nextTicketId}
        onClick={() => adjacentData.nextTicketId && navigateToTicket(adjacentData.nextTicketId)}
        className="h-5 w-5 p-0"
        aria-label={t('navigation.nextTicket', 'Next ticket')}
      >
        <ChevronRight className="h3 w-3" />
      </Button>
    </div>
  );
}
