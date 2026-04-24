'use client';

import { Suspense, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { NotificationSettings, EmailTemplates, NotificationCategories, InternalNotificationCategories } from "@alga-psa/notifications/components";
import { CustomTabs } from "@alga-psa/ui/components/CustomTabs";
import ViewSwitcher, { ViewSwitcherOption } from "@alga-psa/ui/components/ViewSwitcher";
import { Card } from "@alga-psa/ui/components/Card";
import { UnsavedChangesProvider, useUnsavedChanges } from "@alga-psa/ui";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";

type NotificationView = 'email' | 'internal';

const EMAIL_NOTIFICATION_TAB_IDS = ['settings', 'email-templates', 'categories'] as const;
const INTERNAL_NOTIFICATION_TAB_IDS = ['categories-types'] as const;

const DEFAULT_EMAIL_TAB = 'settings';
const DEFAULT_INTERNAL_TAB = 'categories-types';

export default function NotificationsSettingsPage() {
  const { t } = useTranslation('msp/settings');
  return (
    <UnsavedChangesProvider
      dialogTitle={t('notifications.unsaved.title')}
      dialogMessage={t('notifications.unsaved.message')}
    >
      <NotificationsSettingsContent />
    </UnsavedChangesProvider>
  );
}

function NotificationsSettingsContent() {
  const { t } = useTranslation('msp/settings');
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
    const requestedTab = tabParam?.toLowerCase();
    const validTabs: readonly string[] = view === 'email' ? EMAIL_NOTIFICATION_TAB_IDS : INTERNAL_NOTIFICATION_TAB_IDS;
    const defaultTab = view === 'email' ? DEFAULT_EMAIL_TAB : DEFAULT_INTERNAL_TAB;

    if (requestedTab && validTabs.includes(requestedTab)) {
      return requestedTab;
    }

    return defaultTab;
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
  const updateURL = useCallback((view: NotificationView, tabId: string) => {
    const currentSearchParams = new URLSearchParams(window.location.search);

    // Update view parameter
    if (view === 'email') {
      currentSearchParams.set('view', 'email');
    } else {
      currentSearchParams.delete('view');
    }

    // Update tab parameter
    const defaultTab = view === 'email' ? DEFAULT_EMAIL_TAB : DEFAULT_INTERNAL_TAB;

    if (tabId !== defaultTab) {
      currentSearchParams.set('tab', tabId);
    } else {
      currentSearchParams.delete('tab');
    }

    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  }, []);

  const viewOptions: ViewSwitcherOption<NotificationView>[] = [
    { value: 'email', label: t('notifications.viewSwitcher.email') },
    { value: 'internal', label: t('notifications.viewSwitcher.internal') },
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
      id: 'settings',
      label: t('notifications.emailTabs.settings'),
      content: (
        <Suspense fallback={<div>{t('notifications.loading.settings')}</div>}>
          <NotificationSettings />
        </Suspense>
      ),
    },
    {
      id: 'email-templates',
      label: t('notifications.emailTabs.emailTemplates'),
      content: (
        <Suspense fallback={<div>{t('notifications.loading.templates')}</div>}>
          <EmailTemplates />
        </Suspense>
      ),
    },
    {
      id: 'categories',
      label: t('notifications.emailTabs.categories'),
      content: (
        <Suspense fallback={<div>{t('notifications.loading.categories')}</div>}>
          <NotificationCategories />
        </Suspense>
      ),
    },
  ];

  const internalTabs = [
    {
      id: 'categories-types',
      label: t('notifications.internalTabs.categoriesTypes'),
      content: (
        <Suspense fallback={<div>{t('notifications.loading.categories')}</div>}>
          <InternalNotificationCategories />
        </Suspense>
      ),
    },
  ];

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t('notifications.title')}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {currentView === 'email'
              ? t('notifications.tenantDescription.email')
              : t('notifications.tenantDescription.internal')}
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
