'use client';


import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import { CustomTabs } from "@alga-psa/ui/components/CustomTabs";
import ViewSwitcher, { ViewSwitcherOption } from "@alga-psa/ui/components/ViewSwitcher";
import { NotificationSettings, EmailTemplates, NotificationCategories, InternalNotificationCategories } from "@alga-psa/notifications/components";
import { TelemetrySettings } from "@alga-psa/ui/components/settings/telemetry/TelemetrySettings";
import { useUnsavedChanges } from "@alga-psa/ui";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type NotificationView = 'email' | 'internal';

export default function NotificationsTab() {
  return <NotificationsTabContent />;
}

function NotificationsTabContent() {
  const { t } = useTranslation('msp/settings');
  const searchParams = useSearchParams();
  const viewParam = searchParams?.get('view');
  const sectionParam = searchParams?.get('section');

  // Map URL slugs to tab labels for email view
  const emailSectionToLabelMap: Record<string, string> = {
    'settings': 'Settings',
    'email-templates': 'Email Templates',
    'categories': 'Categories',
    'telemetry': 'Telemetry'
  };

  // Map URL slugs to tab labels for internal view
  const internalSectionToLabelMap: Record<string, string> = {
    'categories': 'Categories'
  };

  // Map tab labels back to URL slugs for email view
  const emailLabelToSlugMap: Record<string, string> = {
    'Settings': 'settings',
    'Email Templates': 'email-templates',
    'Categories': 'categories',
    'Telemetry': 'telemetry'
  };

  // Map tab labels back to URL slugs for internal view
  const internalLabelToSlugMap: Record<string, string> = {
    'Categories': 'categories'
  };

  // Determine initial view based on URL parameter
  const getInitialView = (): NotificationView => {
    if (viewParam === 'internal') return 'internal';
    return 'email';
  };

  // Determine initial tab based on URL parameter and view
  const getInitialTab = (view: NotificationView): string => {
    if (!sectionParam) {
      return view === 'email' ? 'Settings' : 'Categories';
    }
    const sectionMap = view === 'email' ? emailSectionToLabelMap : internalSectionToLabelMap;
    return sectionMap[sectionParam.toLowerCase()] || (view === 'email' ? 'Settings' : 'Categories');
  };

  const initialView = getInitialView();
  const [currentView, setCurrentView] = useState<NotificationView>(initialView);
  const [currentTab, setCurrentTab] = useState<string>(getInitialTab(initialView));
  const { confirmNavigation } = useUnsavedChanges();

  // Update state when URL parameters change
  useEffect(() => {
    const newView = getInitialView();
    const newTab = getInitialTab(newView);

    if (newView !== currentView) {
      setCurrentView(newView);
      setCurrentTab(newTab);
    } else if (newTab !== currentTab) {
      setCurrentTab(newTab);
    }
  }, [viewParam, sectionParam, currentView, currentTab]);

  // Update URL when view or tab changes
  const updateURL = useCallback((view: NotificationView, tabLabel: string) => {
    const currentSearchParams = new URLSearchParams(window.location.search);

    // Update view parameter
    if (view === 'internal') {
      currentSearchParams.set('view', 'internal');
    } else {
      currentSearchParams.delete('view');
    }

    // Update section parameter
    const slugMap = view === 'email' ? emailLabelToSlugMap : internalLabelToSlugMap;
    const urlSlug = slugMap[tabLabel];
    const defaultSlug = view === 'email' ? 'settings' : 'categories';

    if (urlSlug && urlSlug !== defaultSlug) {
      currentSearchParams.set('section', urlSlug);
    } else {
      currentSearchParams.delete('section');
    }

    // Keep the tab=notifications parameter
    if (!currentSearchParams.has('tab')) {
      currentSearchParams.set('tab', 'notifications');
    }

    const newUrl = `/msp/settings?${currentSearchParams.toString()}`;
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
      setCurrentView(newView);
      // Reset to first tab of new view
      const newTab = newView === 'email' ? 'Settings' : 'Categories';
      setCurrentTab(newTab);
      updateURL(newView, newTab);
    });
  }, [currentView, confirmNavigation, updateURL]);

  // Handle tab change with confirmation
  const handleTabChange = useCallback((newTab: string) => {
    if (newTab === currentTab) return;

    confirmNavigation(() => {
      setCurrentTab(newTab);
      updateURL(currentView, newTab);
    });
  }, [currentTab, currentView, confirmNavigation, updateURL]);

  const emailTabContent = [
    {
      label: "Settings",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('notifications.sections.globalSettings.title')}</CardTitle>
            <CardDescription>{t('notifications.sections.globalSettings.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationSettings />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Email Templates",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('notifications.sections.emailTemplates.title')}</CardTitle>
            <CardDescription>{t('notifications.sections.emailTemplates.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <EmailTemplates />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Categories",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('notifications.sections.categories.title')}</CardTitle>
            <CardDescription>{t('notifications.sections.categories.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationCategories />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Telemetry",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('notifications.sections.telemetry.title')}</CardTitle>
            <CardDescription>{t('notifications.sections.telemetry.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <TelemetrySettings />
          </CardContent>
        </Card>
      ),
    },
  ];

  const internalTabContent = [
    {
      label: "Categories",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('notifications.sections.internalCategories.title')}</CardTitle>
            <CardDescription>{t('notifications.sections.internalCategories.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <InternalNotificationCategories />
          </CardContent>
        </Card>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('notifications.title')}</CardTitle>
            <CardDescription>
              {currentView === 'email'
                ? t('notifications.description.email')
                : t('notifications.description.internal')}
            </CardDescription>
          </div>
          <ViewSwitcher
            currentView={currentView}
            onChange={handleViewChange}
            options={viewOptions}
          />
        </div>
      </CardHeader>
      <CardContent>
        <CustomTabs
          key={currentView}
          tabs={currentView === 'email' ? emailTabContent : internalTabContent}
          value={currentTab}
          onTabChange={handleTabChange}
        />
      </CardContent>
    </Card>
  );
}
