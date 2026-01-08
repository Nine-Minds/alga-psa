'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ActivityFilters, NotificationActivity } from "server/src/interfaces/activity.interfaces";
import { Button } from "server/src/components/ui/Button";
import { Card } from "server/src/components/ui/Card";
import { NotificationCard } from "server/src/components/user-activities/NotificationCard";
import { fetchNotificationActivities } from "server/src/lib/actions/activity-actions/activityServerActions";
import { NotificationSectionFiltersDialog } from "server/src/components/user-activities/filters/NotificationSectionFiltersDialog";
import { Filter, XCircleIcon } from 'lucide-react';
import { useActivityDrawer } from "server/src/components/user-activities/ActivityDrawerProvider";
import { getUnreadCountAction } from "server/src/lib/actions/internal-notification-actions/internalNotificationActions";
import { getCurrentUser } from "server/src/lib/actions/user-actions/userActions";
import { Badge } from "server/src/components/ui/Badge";
import { useTranslation } from 'server/src/lib/i18n/client';
import CustomTabs from 'server/src/components/ui/CustomTabs';

// Map URL slugs to tab keys (language-independent)
const TAB_SLUG_MAP: Record<string, string> = {
  'unread': 'unread',
  'all': 'all',
  'read': 'read'
};

// Map tab keys to URL slugs
const TAB_KEY_TO_SLUG: Record<string, string> = {
  'unread': 'unread',
  'all': 'all',
  'read': 'read'
};

export function ClientNotificationsList() {
  const { t } = useTranslation('clientPortal');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  // Get translated tab labels
  const unreadTabLabel = t('notifications.tabs.unread', 'Unread');
  const allTabLabel = t('notifications.tabs.all', 'All');
  const readTabLabel = t('notifications.tabs.read', 'Read');

  // Map tab keys to translated labels
  const tabKeyToLabel: Record<string, string> = useMemo(() => ({
    'unread': unreadTabLabel,
    'all': allTabLabel,
    'read': readTabLabel
  }), [unreadTabLabel, allTabLabel, readTabLabel]);

  // Map translated labels to tab keys
  const labelToTabKey: Record<string, string> = useMemo(() => ({
    [unreadTabLabel]: 'unread',
    [allTabLabel]: 'all',
    [readTabLabel]: 'read'
  }), [unreadTabLabel, allTabLabel, readTabLabel]);

  // Determine initial tab from URL or default to "unread"
  const initialTab = useMemo(() => {
    if (tabParam) {
      const tabKey = TAB_SLUG_MAP[tabParam.toLowerCase()];
      if (tabKey && tabKeyToLabel[tabKey]) {
        return tabKeyToLabel[tabKey];
      }
    }
    return unreadTabLabel; // Default to Unread
  }, [tabParam, tabKeyToLabel, unreadTabLabel]);

  const [activities, setActivities] = useState<NotificationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const { openActivityDrawer } = useActivityDrawer();
  const [error, setError] = useState<string | null>(null);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [notificationFilters, setNotificationFilters] = useState<Partial<ActivityFilters>>(() => {
    // Set initial filters based on URL tab parameter
    if (tabParam) {
      const tabKey = TAB_SLUG_MAP[tabParam.toLowerCase()];
      if (tabKey === 'read') {
        return { isClosed: true };
      } else if (tabKey === 'all') {
        return {};
      }
    }
    return { isClosed: false }; // Default: show unread only
  });
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // Update active tab when URL parameter changes
  useEffect(() => {
    if (tabParam) {
      const tabKey = TAB_SLUG_MAP[tabParam.toLowerCase()];
      if (tabKey && tabKeyToLabel[tabKey]) {
        const targetTab = tabKeyToLabel[tabKey];
        if (targetTab !== activeTab) {
          setActiveTab(targetTab);
          // Also update filters based on the tab
          if (tabKey === 'read') {
            setNotificationFilters(prev => ({ ...prev, isClosed: true }));
          } else if (tabKey === 'all') {
            setNotificationFilters(prev => {
              const { isClosed, ...rest } = prev;
              return rest;
            });
          } else {
            setNotificationFilters(prev => ({ ...prev, isClosed: false }));
          }
        }
      }
    }
  }, [tabParam, tabKeyToLabel, activeTab]);

  // Fetch initial activities
  const loadActivities = useCallback(async (filters: Partial<ActivityFilters>) => {
    try {
      setLoading(true);
      setError(null);

      // Fetch notification activities using current filters
      const result = await fetchNotificationActivities(filters);

      // Sort by creation date (newest first)
      const sortedActivities = result.sort((a: NotificationActivity, b: NotificationActivity) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      setActivities(sortedActivities);
    } catch (err) {
      console.error('Error loading notification activities:', err);
      setError(t('notifications.preferences.loadError', 'Failed to load notifications'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Fetch unread count
  const loadUnreadCount = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      if (user) {
        const result = await getUnreadCountAction(user.tenant, user.user_id);
        setUnreadCount(result.unread_count);
      }
    } catch (err) {
      console.error('Error loading unread count:', err);
    }
  }, []);

  // Load activities initially and when filters change
  useEffect(() => {
    loadActivities(notificationFilters);
    loadUnreadCount();
  }, [notificationFilters, loadActivities, loadUnreadCount]);

  const handleRefresh = () => {
    // Reload activities with the current filters
    loadActivities(notificationFilters);
    loadUnreadCount();
  };

  const handleApplyFilters = (newFilters: Partial<ActivityFilters>) => {
    setNotificationFilters(prevFilters => ({
      ...prevFilters,
      ...newFilters,
    }));
  };

  // Function to check if filters are active (beyond the default)
  const isFiltersActive = useCallback(() => {
    const defaultFilters: Partial<ActivityFilters> = { isClosed: false };
    // Check if any filter key exists beyond the default 'isClosed'
    const hasExtraKeys = Object.keys(notificationFilters).some(key => !(key in defaultFilters));
    // Check if 'isClosed' is different from the default
    const isClosedChanged = notificationFilters.isClosed !== defaultFilters.isClosed;
    // Check if any filter value is actually set
    const hasSetValues = Object.entries(notificationFilters).some(([key, value]) => {
      if (key === 'isClosed') return value !== false;
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    });

    return hasExtraKeys || isClosedChanged || hasSetValues;
  }, [notificationFilters]);

  const handleResetFilters = () => {
    setNotificationFilters({ isClosed: false }); // Reset to default filters
  };

  // Handle tab change to update filters and URL
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);

    // Update filters based on tab
    if (tab === unreadTabLabel) {
      // Show unread notifications
      setNotificationFilters(prev => ({ ...prev, isClosed: false }));
    } else if (tab === readTabLabel) {
      // Show read notifications
      setNotificationFilters(prev => ({ ...prev, isClosed: true }));
    } else if (tab === allTabLabel) {
      // Show all notifications
      const { isClosed, ...rest } = notificationFilters;
      setNotificationFilters(rest);
    }

    // Update URL with the new tab
    if (typeof window !== 'undefined') {
      const tabKey = labelToTabKey[tab];
      const params = new URLSearchParams(window.location.search);

      if (tabKey === 'unread') {
        // Default tab - remove from URL
        params.delete('tab');
      } else if (tabKey) {
        params.set('tab', TAB_KEY_TO_SLUG[tabKey]);
      }

      const basePath = window.location.pathname;
      const newUrl = params.toString()
        ? `${basePath}?${params.toString()}`
        : basePath;
      window.history.pushState({}, '', newUrl);
    }
  };

  // Render notifications content
  const renderNotifications = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">{t('common.loading')}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex justify-center items-center h-40">
          <p className="text-red-500">{error}</p>
        </div>
      );
    }

    if (activities.length === 0) {
      return (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">{t('notifications.noNotifications')}</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-4">
        {activities.map(activity => (
          <NotificationCard
            key={activity.id}
            activity={activity}
            onViewDetails={() => openActivityDrawer(activity)}
            onActionComplete={handleRefresh}
          />
        ))}
      </div>
    );
  };

  const tabContent = [
    {
      label: unreadTabLabel,
      content: renderNotifications()
    },
    {
      label: allTabLabel,
      content: renderNotifications()
    },
    {
      label: readTabLabel,
      content: renderNotifications()
    }
  ];

  const tabStyles = {
    trigger: "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 border-b-2 border-transparent",
    activeTrigger: "data-[state=active]:border-blue-500 data-[state=active]:text-blue-600"
  };

  return (
    <Card className="bg-white">
      <div className="p-6 space-y-4">
        {/* Header with filters */}
        <div className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{t('notifications.title')}</h3>
            {unreadCount > 0 && (
              <Badge variant="default" className="bg-blue-500">
                {unreadCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              id="refresh-notifications-button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
              aria-label={t('common.refresh', 'Refresh')}
            >
              {t('common.refresh', 'Refresh')}
            </Button>
            {isFiltersActive() ? (
              <Button
                id="reset-notification-filters-button"
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                disabled={loading}
                className="gap-1"
              >
                <XCircleIcon className="h-4 w-4" />
                {t('common.resetFilters', 'Reset Filters')}
              </Button>
            ) : (
              <Button
                id="filter-notifications-button"
                variant="outline"
                size="sm"
                onClick={() => setIsFilterDialogOpen(true)}
                disabled={loading}
                aria-label={t('common.filter', 'Filter')}
              >
                <Filter size={16} className="mr-1" /> {t('common.filter', 'Filter')}
              </Button>
            )}
          </div>
        </div>

        {/* Tabs for filtering notifications */}
        <CustomTabs
          tabs={tabContent}
          defaultTab={activeTab}
          onTabChange={handleTabChange}
          tabStyles={tabStyles}
        />

        {isFilterDialogOpen && (
          <NotificationSectionFiltersDialog
            isOpen={isFilterDialogOpen}
            onOpenChange={setIsFilterDialogOpen}
            initialFilters={notificationFilters}
            onApplyFilters={handleApplyFilters}
          />
        )}
      </div>
    </Card>
  );
}
