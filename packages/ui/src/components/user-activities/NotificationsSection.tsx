import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ActivityFilters, NotificationActivity } from "server/src/interfaces/activity.interfaces";
import { Button } from "@alga-psa/ui/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import { NotificationCard } from "./NotificationCard";
import { fetchNotificationActivities } from "server/src/lib/actions/activity-actions/activityServerActions";
import { NotificationSectionFiltersDialog } from "./filters/NotificationSectionFiltersDialog";
import { Filter, XCircleIcon } from 'lucide-react';
import { useActivityDrawer } from "./ActivityDrawerProvider";
import { getCurrentUser } from "server/src/lib/actions/user-actions/userActions";
import { Badge } from "@alga-psa/ui/components/Badge";
import { useInternalNotifications } from "server/src/hooks/useInternalNotifications";
import { useSession } from 'next-auth/react';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';

interface NotificationsSectionProps {
  limit?: number;
  onViewAll?: () => void;
  noCard?: boolean;
}

// Map URL slugs to tab labels
const tabSlugToLabelMap: Record<string, string> = {
  'unread': 'Unread',
  'all': 'All',
  'read': 'Read'
};

// Map tab labels to URL slugs
const tabLabelToSlugMap: Record<string, string> = {
  'Unread': 'unread',
  'All': 'all',
  'Read': 'read'
};

export function NotificationsSection({ limit = 5, onViewAll, noCard = false }: NotificationsSectionProps) {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const notificationTabParam = searchParams?.get('notificationTab');

  const [activities, setActivities] = useState<NotificationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const { openActivityDrawer } = useActivityDrawer();
  const [error, setError] = useState<string | null>(null);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);

  // Determine initial tab from URL or default to "Unread"
  const initialTab = useMemo(() => {
    if (notificationTabParam) {
      const label = tabSlugToLabelMap[notificationTabParam.toLowerCase()];
      if (label) return label;
    }
    return 'Unread';
  }, [notificationTabParam]);

  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [notificationFilters, setNotificationFilters] = useState<Partial<ActivityFilters>>({
    isClosed: false // Default: show unread only
  });

  // Use real-time notifications hook to detect changes
  const tenant = session?.user?.tenant;
  const userId = session?.user?.id;
  const realTimeHook = useInternalNotifications({
    tenant: tenant || '',
    userId: userId || '',
    limit: 1, // We only need this to detect changes, not to display
    enablePolling: true
  });

  // Track previous unread count to detect changes
  const prevUnreadCountRef = useRef<number>(realTimeHook.unreadCount);
  const prevNotificationCountRef = useRef<number>(realTimeHook.notifications.length);

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

      setActivities(sortedActivities.slice(0, limit));
    } catch (err) {
      console.error('Error loading notification activities:', err);
      setError('Failed to load notification activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // Load activities initially and when filters change
  useEffect(() => {
    loadActivities(notificationFilters);
  }, [notificationFilters, loadActivities]);

  // Update active tab when URL parameter changes
  useEffect(() => {
    if (notificationTabParam) {
      const label = tabSlugToLabelMap[notificationTabParam.toLowerCase()];
      if (label && label !== activeTab) {
        setActiveTab(label);
        // Also update filters based on the new tab
        if (label === "Unread") {
          setNotificationFilters(prev => ({ ...prev, isClosed: false }));
        } else if (label === "Read") {
          setNotificationFilters(prev => ({ ...prev, isClosed: true }));
        } else if (label === "All") {
          setNotificationFilters(prev => {
            const { isClosed, ...rest } = prev;
            return rest;
          });
        }
      }
    }
  }, [notificationTabParam, activeTab]);

  // Watch for changes in real-time notifications and auto-refresh
  useEffect(() => {
    // Skip initial render
    if (prevUnreadCountRef.current === undefined) {
      prevUnreadCountRef.current = realTimeHook.unreadCount;
      prevNotificationCountRef.current = realTimeHook.notifications.length;
      return;
    }

    // Check if unread count or notification count changed
    const unreadCountChanged = prevUnreadCountRef.current !== realTimeHook.unreadCount;
    const notificationCountChanged = prevNotificationCountRef.current !== realTimeHook.notifications.length;

    if (unreadCountChanged || notificationCountChanged) {
      console.log('Notifications changed, auto-refreshing list...');
      loadActivities(notificationFilters);
      prevUnreadCountRef.current = realTimeHook.unreadCount;
      prevNotificationCountRef.current = realTimeHook.notifications.length;
    }
  }, [realTimeHook.unreadCount, realTimeHook.notifications.length, loadActivities, notificationFilters]);

  const handleRefresh = () => {
    // Reload activities with the current filters
    loadActivities(notificationFilters);
    // Real-time hook will automatically update unread count
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

    if (tab === "Unread") {
      // Show unread notifications
      setNotificationFilters(prev => ({ ...prev, isClosed: false }));
    } else if (tab === "Read") {
      // Show read notifications
      setNotificationFilters(prev => ({ ...prev, isClosed: true }));
    } else if (tab === "All") {
      // Show all notifications
      const { isClosed, ...rest } = notificationFilters;
      setNotificationFilters(rest);
    }

    // Update URL with the new tab
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const slug = tabLabelToSlugMap[tab];
      if (slug && slug !== 'unread') {
        params.set('notificationTab', slug);
      } else {
        params.delete('notificationTab');
      }
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.pushState({}, '', newUrl);
    }
  };

  const headerContent = (
    <div className="flex flex-row items-center justify-between pb-2 px-6 pt-6">
      <div className="flex items-center gap-2">
        {!noCard && <h3 className="text-lg font-semibold">Notifications</h3>}
        {realTimeHook.unreadCount > 0 && (
          <Badge variant="default" className="bg-blue-500">
            {realTimeHook.unreadCount}
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
          aria-label="Refresh Notifications"
        >
          Refresh
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
            Reset Filters
          </Button>
        ) : (
          <Button
            id="filter-notifications-button"
            variant="outline"
            size="sm"
            onClick={() => setIsFilterDialogOpen(true)}
            disabled={loading}
            aria-label="Filter Notifications"
          >
            <Filter size={16} className="mr-1" /> Filter
          </Button>
        )}
        <Button
          id="view-all-notifications-button"
          variant="outline"
          size="sm"
          onClick={onViewAll}
        >
          View All
        </Button>
      </div>
    </div>
  );

  // Render notifications content
  const renderNotifications = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">Loading notification activities...</p>
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
          <p className="text-gray-500">No notification activities found</p>
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
      label: "Unread",
      content: renderNotifications()
    },
    {
      label: "All",
      content: renderNotifications()
    },
    {
      label: "Read",
      content: renderNotifications()
    }
  ];

  const tabStyles = {
    trigger: "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 border-b-2 border-transparent",
    activeTrigger: "data-[state=active]:border-blue-500 data-[state=active]:text-blue-600"
  };

  const bodyContent = (
    <div className="px-6 pb-6">
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
    <Card id="notifications-activities-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <CardTitle>Notifications</CardTitle>
          {realTimeHook.unreadCount > 0 && (
            <Badge variant="default" className="bg-blue-500">
              {realTimeHook.unreadCount}
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
            aria-label="Refresh Notifications"
          >
            Refresh
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
              Reset Filters
            </Button>
          ) : (
            <Button
              id="filter-notifications-button"
              variant="outline"
              size="sm"
              onClick={() => setIsFilterDialogOpen(true)}
              disabled={loading}
              aria-label="Filter Notifications"
            >
              <Filter size={16} className="mr-1" /> Filter
            </Button>
          )}
          <Button
            id="view-all-notifications-button"
            variant="outline"
            size="sm"
            onClick={onViewAll}
          >
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <CustomTabs
          tabs={tabContent}
          defaultTab={activeTab}
          onTabChange={handleTabChange}
          tabStyles={tabStyles}
        />
      </CardContent>

      {isFilterDialogOpen && (
        <NotificationSectionFiltersDialog
          isOpen={isFilterDialogOpen}
          onOpenChange={setIsFilterDialogOpen}
          initialFilters={notificationFilters}
          onApplyFilters={handleApplyFilters}
        />
      )}
    </Card>
  );
}
