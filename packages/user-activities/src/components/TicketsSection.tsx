'use client';


import React from 'react';
import { TicketActivity, ActivityFilters, ActivityType } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { TicketCard } from './ActivityCard';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useActivitySectionFeed } from '../hooks/useActivitySectionFeed';

interface TicketsSectionProps {
  limit?: number;
  onViewAll?: () => void;
  /** The shared filter model (the same one the table uses). */
  filters: ActivityFilters;
  targetUserId?: string;
  /** Viewing another user: no action menus. */
  readOnly?: boolean;
}

export function TicketsSection({ limit = 5, onViewAll, filters, targetUserId = '', readOnly = false }: TicketsSectionProps) {
  const { t } = useTranslation('msp/user-activities');
  const { openActivityDrawer } = useActivityDrawer();
  const feed = useActivitySectionFeed<TicketActivity>(ActivityType.TICKET, filters, targetUserId, limit);
  const { activities, loading } = feed;
  const error = feed.error
    ? t('sections.tickets.errors.loadFailed', { defaultValue: 'Failed to load ticket activities. Please try again later.' })
    : null;

  return (
    <Card id="tickets-activities-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{t('sections.tickets.title', { defaultValue: 'Tickets' })}</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-tickets-button"
            variant="outline"
            size="sm"
            onClick={feed.refresh}
            disabled={loading}
            aria-label={t('sections.tickets.ariaLabels.refresh', { defaultValue: 'Refresh Tickets' })}
          >
            {t('sections.tickets.actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            id="view-all-tickets-button"
            variant="outline"
            size="sm"
            onClick={onViewAll}
          >
            {t('sections.tickets.actions.viewAll', { defaultValue: 'View All' })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('sections.tickets.states.loading', { defaultValue: 'Loading ticket activities...' })}</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-destructive">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('sections.tickets.states.empty', { defaultValue: 'No ticket activities found' })}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activities.map(activity => (
              <TicketCard
                key={activity.id}
                activity={activity}
                onViewDetails={() => openActivityDrawer(activity)}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
