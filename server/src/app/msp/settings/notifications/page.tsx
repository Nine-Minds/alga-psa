'use client';

import { Suspense, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { NotificationSettings, EmailTemplates, NotificationCategories, InternalNotificationCategories } from "@alga-psa/notifications/components";
import { CustomTabs } from "@alga-psa/ui/components/CustomTabs";
import ViewSwitcher, { ViewSwitcherOption } from "@alga-psa/ui/components/ViewSwitcher";
import { Card } from "@alga-psa/ui/components/Card";
import { UnsavedChangesProvider, useUnsavedChanges } from "server/src/contexts/UnsavedChangesContext";

type NotificationView = 'email' | 'internal';

// Map URL slugs to tab labels for each view
const EMAIL_TAB_SLUG_TO_LABEL: Record<string, string> = {
  'settings': 'Settings',
  'email-templates': 'Email Templates',
  'categories': 'Categories',
};

const INTERNAL_TAB_SLUG_TO_LABEL: Record<string, string> = {
  'categories-types': 'Categories & Types',
};

// Map tab labels to URL slugs
const EMAIL_TAB_LABEL_TO_SLUG: Record<string, string> = {
  'Settings': 'settings',
  'Email Templates': 'email-templates',
  'Categories': 'categories',
};

const INTERNAL_TAB_LABEL_TO_SLUG: Record<string, string> = {
  'Categories & Types': 'categories-types',
};

const DEFAULT_EMAIL_TAB = 'Settings';
const DEFAULT_INTERNAL_TAB = 'Categories & Types';

export default function NotificationsSettingsPage() {
  return (
    <UnsavedChangesProvider
      dialogTitle="Unsaved Changes"
      dialogMessage="You have unsaved notification settings. Are you sure you want to leave? Your changes will be lost."
    >
      <NotificationsSettingsContent />
    </UnsavedChangesProvider>
  );
}

function NotificationsSettingsContent() {
  const searchParams = useSearchParams();
  const viewParam = searchParams?.get('view');
  const tabParam = searchParams?.get('tab');
  const { confirmNavigation } = useUnsavedChanges();

  // Determine initial view and tab from URL
  const getInitialView = (): NotificationView => {
    if (viewParam === 'email') return 'email';
    return 'internal';
  };

  const getInitialTab = (view: NotificationView): string => {
    if (!tabParam) {
      return view === 'email' ? DEFAULT_EMAIL_TAB : DEFAULT_INTERNAL_TAB;
    }
    const slugMap = view === 'email' ? EMAIL_TAB_SLUG_TO_LABEL : INTERNAL_TAB_SLUG_TO_LABEL;
    return slugMap[tabParam.toLowerCase()] || (view === 'email' ? DEFAULT_EMAIL_TAB : DEFAULT_INTERNAL_TAB);
  };

  const initialView = getInitialView();
  const [currentView, setCurrentView] = useState<NotificationView>(initialView);
  const [currentTab, setCurrentTab] = useState<string>(getInitialTab(initialView));

  // Sync state when URL changes
  useEffect(() => {
    const newView = getInitialView();
    const newTab = getInitialTab(newView);

    if (newView !== currentView) {
      setCurrentView(newView);
      setCurrentTab(newTab);
    } else if (newTab !== currentTab) {
      setCurrentTab(newTab);
    }
  }, [viewParam, tabParam, currentView, currentTab]);

  // Update URL helper
  const updateURL = useCallback((view: NotificationView, tabLabel: string) => {
    const currentSearchParams = new URLSearchParams(window.location.search);

    // Update view parameter
    if (view === 'email') {
      currentSearchParams.set('view', 'email');
    } else {
      currentSearchParams.delete('view');
    }

    // Update tab parameter
    const slugMap = view === 'email' ? EMAIL_TAB_LABEL_TO_SLUG : INTERNAL_TAB_LABEL_TO_SLUG;
    const defaultTab = view === 'email' ? DEFAULT_EMAIL_TAB : DEFAULT_INTERNAL_TAB;
    const urlSlug = slugMap[tabLabel];

    if (urlSlug && tabLabel !== defaultTab) {
      currentSearchParams.set('tab', urlSlug);
    } else {
      currentSearchParams.delete('tab');
    }

    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  }, []);

  const viewOptions: ViewSwitcherOption<NotificationView>[] = [
    { value: 'email', label: 'Email Notifications' },
    { value: 'internal', label: 'Internal Notifications' },
  ];

  // Handle view change with confirmation
  const handleViewChange = useCallback((newView: NotificationView) => {
    if (newView === currentView) return;

    confirmNavigation(() => {
      const newTab = newView === 'email' ? DEFAULT_EMAIL_TAB : DEFAULT_INTERNAL_TAB;
      setCurrentView(newView);
      setCurrentTab(newTab);
      updateURL(newView, newTab);
    });
  }, [currentView, confirmNavigation, updateURL]);

  // Handle tab change with confirmation (controlled mode)
  const handleTabChange = useCallback((newTab: string) => {
    if (newTab === currentTab) return;

    confirmNavigation(() => {
      setCurrentTab(newTab);
      updateURL(currentView, newTab);
    });
  }, [currentTab, currentView, confirmNavigation, updateURL]);

  const emailTabs = [
    {
      label: "Settings",
      content: (
        <Suspense fallback={<div>Loading settings...</div>}>
          <NotificationSettings />
        </Suspense>
      ),
    },
    {
      label: "Email Templates",
      content: (
        <Suspense fallback={<div>Loading templates...</div>}>
          <EmailTemplates />
        </Suspense>
      ),
    },
    {
      label: "Categories",
      content: (
        <Suspense fallback={<div>Loading categories...</div>}>
          <NotificationCategories />
        </Suspense>
      ),
    },
  ];

  const internalTabs = [
    {
      label: "Categories & Types",
      content: (
        <Suspense fallback={<div>Loading categories...</div>}>
          <InternalNotificationCategories />
        </Suspense>
      ),
    },
  ];

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Notification Settings</h1>
          <p className="text-gray-600 text-sm mt-1">
            {currentView === 'email'
              ? 'Configure tenant-wide email notification settings'
              : 'Configure tenant-wide internal notification settings'}
          </p>
        </div>
        <ViewSwitcher
          currentView={currentView}
          onChange={handleViewChange}
          options={viewOptions}
        />
      </div>
      <Card>
        <CustomTabs
          key={currentView}
          tabs={currentView === 'email' ? emailTabs : internalTabs}
          value={currentTab}
          onTabChange={handleTabChange}
        />
      </Card>
    </div>
  );
}
