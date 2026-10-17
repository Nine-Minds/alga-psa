'use client';


import React, { useState } from 'react';
import { ActivityFilters, ScheduleActivity, ActivityType } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ScheduleCard } from './ActivityCard';
import { createAdHocActivity } from '@alga-psa/user-activities/actions';
import { Plus } from 'lucide-react';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useActivitySectionFeed } from '../hooks/useActivitySectionFeed';

interface ScheduleSectionProps {
  limit?: number;
  onViewAll?: () => void;
  noCard?: boolean;
  /** The shared filter model (the same one the table uses). */
  filters: ActivityFilters;
  targetUserId?: string;
  /** Viewing another user: no quick-add, no action menus. */
  readOnly?: boolean;
}

export function ScheduleSection({ limit = 5, onViewAll, noCard = false, filters, targetUserId = '', readOnly = false }: ScheduleSectionProps) {
  const { t } = useTranslation('msp/user-activities');
  const { openActivityDrawer } = useActivityDrawer();
  const [adHocTitle, setAdHocTitle] = useState('');
  const [isAddingAdHoc, setIsAddingAdHoc] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Recurring series collapse server-side, before pagination, so a 5-row preview shows 5 series.
  const feed = useActivitySectionFeed<ScheduleActivity>(
    ActivityType.SCHEDULE,
    filters,
    targetUserId,
    limit,
    { collapseRecurringSeries: true }
  );
  const { activities, loading } = feed;
  const error = addError
    ?? (feed.error
      ? t('sections.schedule.errors.loadFailed', { defaultValue: 'Failed to load schedule activities. Please try again later.' })
      : null);

  const handleRefresh = () => {
    setAddError(null);
    feed.refresh();
  };

  const handleAddAdHoc = async () => {
    const title = adHocTitle.trim();
    if (!title || isAddingAdHoc) return;
    setIsAddingAdHoc(true);
    try {
      await createAdHocActivity({ title });
      setAdHocTitle('');
      setAddError(null);
      feed.refresh();
    } catch (err) {
      console.error('Error creating ad-hoc item:', err);
      setAddError(t('sections.schedule.errors.addAdHocFailed', { defaultValue: 'Failed to add activity. Please try again.' }));
    } finally {
      setIsAddingAdHoc(false);
    }
  };

  const quickAddRow = readOnly ? null : (
    <div className="mb-4 flex items-center gap-2">
      <Input
        id="schedule-add-adhoc-input"
        value={adHocTitle}
        onChange={(e) => setAdHocTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleAddAdHoc();
          }
        }}
        placeholder={t('table.adHoc.addPlaceholder', { defaultValue: 'Add Activity' })}
        className="h-9 max-w-sm text-sm"
        disabled={isAddingAdHoc}
      />
      <Button
        id="schedule-add-adhoc-button"
        variant="default"
        size="sm"
        onClick={() => void handleAddAdHoc()}
        disabled={isAddingAdHoc || adHocTitle.trim().length === 0}
      >
        <Plus className="h-4 w-4 mr-1" />
        {t('table.adHoc.addButton', { defaultValue: 'Add' })}
      </Button>
    </div>
  );

  const headerContent = (
    <div className="flex flex-row items-center justify-between pb-2 px-6 pt-6">
      {!noCard && <h3 className="text-lg font-semibold">{t('sections.schedule.title', { defaultValue: 'Schedule' })}</h3>}
      <div className="flex items-center gap-2">
        <Button
          id="refresh-schedule-button"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
        >
          {t('sections.schedule.actions.refresh', { defaultValue: 'Refresh' })}
        </Button>
        <Button
          id="view-all-schedule-button"
          variant="outline"
          size="sm"
          onClick={onViewAll}
        >
          {t('sections.schedule.actions.viewAll', { defaultValue: 'View All' })}
        </Button>
      </div>
    </div>
  );

  const bodyContent = (
    <div className="px-6 pb-6">
      {quickAddRow}
      {loading ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">{t('sections.schedule.states.loading', { defaultValue: 'Loading schedule activities...' })}</p>
        </div>
      ) : error ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-destructive">{error}</p>
        </div>
      ) : activities.length === 0 ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">{t('sections.schedule.states.empty', { defaultValue: 'No schedule activities found' })}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {activities.map(activity => (
            <ScheduleCard
              key={activity.id}
              activity={activity}
              onViewDetails={() => openActivityDrawer(activity)}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );

  if (noCard) {
    return (
      <>
        {headerContent}
        {bodyContent}
      </>
    );
  }

  return (
    <Card id="schedule-activities-card" className="col-span-1 md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{t('sections.schedule.title', { defaultValue: 'Schedule' })}</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-schedule-button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
          >
            {t('sections.schedule.actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            id="view-all-schedule-button"
            variant="outline"
            size="sm"
            onClick={onViewAll}
          >
            {t('sections.schedule.actions.viewAll', { defaultValue: 'View All' })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {quickAddRow}
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('sections.schedule.states.loading', { defaultValue: 'Loading schedule activities...' })}</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-destructive">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('sections.schedule.states.empty', { defaultValue: 'No schedule activities found' })}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activities.map(activity => (
              <ScheduleCard
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
