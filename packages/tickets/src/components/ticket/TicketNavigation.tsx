'use client';

import React, { useEffect, useState, useCallback, useContext } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { UnsavedChangesContext } from '@alga-psa/ui/context/UnsavedChangesContext';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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

  // Keyboard shortcuts: Alt+ArrowLeft / Alt+ArrowRight
  useEffect(() => {
    if (!adjacentData) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.altKey && e.key === 'ArrowLeft' && adjacentData.prevTicketId) {
        e.preventDefault();
        navigateToTicket(adjacentData.prevTicketId);
      } else if (e.altKey && e.key === 'ArrowRight' && adjacentData.nextTicketId) {
        e.preventDefault();
        navigateToTicket(adjacentData.nextTicketId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [adjacentData, navigateToTicket]);

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
