'use client';


import React, { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { ActivitiesCardsView } from './ActivitiesCardsView';
import { ActivitiesDataTableSection } from './ActivitiesDataTableSection';
import { LayoutGrid, List } from 'lucide-react';
import { ActivityType } from '@alga-psa/types';
import { useActivityFilterState } from '../hooks/useActivityFilterState';
import { useActivityFilterOptions } from '../hooks/useActivityFilterOptions';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ACTIVITY_BOARD_PARAM, parseActivityKey } from '../lib/activityBoardLink';

export function UserActivitiesDashboard() {
  const { t } = useTranslation('msp/user-activities');
  const searchParams = useSearchParams();
  // Bell "View all notifications" deep-links here with ?focus=notifications. Treat it
  // as an EPHEMERAL card-view override (task 29.8.46).
  const focusNotifications = searchParams?.get('focus') === 'notifications';
  const router = useRouter();
  const pathname = usePathname();
  // "Show on my activities" deep-links here with ?activity=<type>:<id>. Like the focus link it
  // is an EPHEMERAL override: it forces the table view for this visit only and never writes
  // the saved view preference. An unparseable value is ignored.
  const activityParam = searchParams?.get(ACTIVITY_BOARD_PARAM) ?? null;
  const [focusActivityKey, setFocusActivityKey] = useState<string | null>(
    () => (parseActivityKey(activityParam) ? activityParam : null)
  );
  useEffect(() => {
    if (activityParam && parseActivityKey(activityParam)) {
      setFocusActivityKey(activityParam);
    }
  }, [activityParam]);
  // Define view mode type
  type UserActivitiesViewMode = 'cards' | 'table';

  // Use the custom hook for view mode preference
  const {
    value: viewMode,
    setValue: setViewModePreference
  } = useUserPreference<UserActivitiesViewMode>(
    'activitiesDashboardViewMode',
    {
      defaultValue: 'table',
      localStorageKey: 'activitiesDashboardViewMode',
      debounceMs: 300
    }
  );

  // Ephemeral, in-memory view override (flag on only): "View All" and the focus deep
  // link switch the view for the current visit WITHOUT persisting the saved preference.
  // The ViewSwitcher remains the only thing that writes the preference.
  const [ephemeralView, setEphemeralView] = useState<UserActivitiesViewMode | null>(null);

  // One filter model for the whole screen: the table and the cards share it, so switching
  // views keeps the filters and "View All" carries them over.
  const filterState = useActivityFilterState();
  const filterOptions = useActivityFilterOptions(filterState.filters.types);
  const { filters, hasOverride, setOverrideFilters, clearOverride } = filterState;

  // Generic handler for "View All" clicks
  const handleViewAll = (types: ActivityType[]) => {
    // The table opens with the current filters, narrowed to the section's type. This visit
    // only: nothing is persisted until the user edits a filter.
    //
    // Notifications is the exception: it is not in the filter bar's type set, its rows have no
    // dueDate (a carried date range would empty the table), and `search` means the notification
    // category for it. So it opens with exactly its own filters, nothing from the bar.
    const isNotificationsOnly = types.length === 1 && types[0] === ActivityType.NOTIFICATION;
    setOverrideFilters(
      isNotificationsOnly ? { types, isClosed: false } : { ...filters, types }
    );
    // Switch to the table view ephemerally; do NOT persist the preference.
    setEphemeralView('table');
  };

  // The section resolved the deep link (highlighted, or reported not found): consume the param
  // so a refresh / back navigation doesn't repeat it, and pin the table view for this visit
  // (the saved preference stays untouched).
  const handleFocusConsumed = useCallback(() => {
    setFocusActivityKey(null);
    setEphemeralView((prev) => prev ?? 'table');
    if (searchParams?.get(ACTIVITY_BOARD_PARAM)) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete(ACTIVITY_BOARD_PARAM);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : (pathname ?? ''), { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const tableViewContent = (
    <ActivitiesDataTableSection
      title={hasOverride
        ? t('dashboard.filteredTitle', { defaultValue: 'Filtered Activities' })
        : t('dashboard.allActivitiesTitle', { defaultValue: 'All Activities' })}
      id="all-activities-table-section"
      focusActivityKey={focusActivityKey}
      onFocusConsumed={handleFocusConsumed}
      filterState={filterState}
      filterOptions={filterOptions}
    />
  );

  // Define options for the ViewSwitcher with explicit type
  const viewOptions: ViewSwitcherOption<UserActivitiesViewMode>[] = [
    { value: 'cards', label: t('dashboard.viewSwitcher.cards', { defaultValue: 'Cards' }), icon: LayoutGrid },
    { value: 'table', label: t('dashboard.viewSwitcher.table', { defaultValue: 'Table' }), icon: List },
  ];

  // Handler for view change (the ViewSwitcher — the only writer of the saved preference)
  const handleViewChange = (newView: UserActivitiesViewMode) => {
    setViewModePreference(newView);
    // An explicit switch also wins over any ephemeral/focus override this visit.
    setEphemeralView(newView);
    // An explicit switch ends any View All narrowing, in both directions.
    clearOverride();
  };

  // Effective view mode: an ephemeral override wins, else the activity deep link forces the
  // table, else the focus deep link forces cards, else the saved preference.
  const effectiveViewMode: UserActivitiesViewMode =
    ephemeralView ?? (focusActivityKey ? 'table' : focusNotifications ? 'cards' : viewMode);

  // Pick the main content. Table always wins when selected; otherwise the focus
  // deep link renders the focus layout, else the standard card view.
  let mainContent: React.ReactNode;
  if (effectiveViewMode === 'table') {
    mainContent = tableViewContent;
  } else {
    mainContent = (
      <ActivitiesCardsView
        filterState={filterState}
        filterOptions={filterOptions}
        focusNotifications={focusNotifications}
        onViewAll={handleViewAll}
      />
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('dashboard.title', { defaultValue: 'User Activities' })}</h1>
        <div className="flex items-center gap-4">
          <ViewSwitcher
            options={viewOptions}
            currentView={effectiveViewMode}
            onChange={handleViewChange}
          />
        </div>
      </div>

      {mainContent}
    </div>
  );
}
