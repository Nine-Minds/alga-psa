'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'server/src/lib/i18n/client';
import { Card, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import TemplateList from './templates/TemplateList';
import TriggerList from './triggers/TriggerList';
import {
  getSurveyTemplates,
  getSurveyTriggers,
} from 'server/src/lib/actions/surveyActions';
import type { SurveyTemplate, SurveyTrigger } from 'server/src/lib/actions/surveyActions';

// Map URL slugs to tab labels
const TAB_SLUG_TO_LABEL: Record<string, string> = {
  'templates': 'Templates',
  'triggers': 'Triggers',
};

// Map tab labels to URL slugs
const TAB_LABEL_TO_SLUG: Record<string, string> = {
  'Templates': 'templates',
  'Triggers': 'triggers',
};

const SurveySettings = (): React.JSX.Element => {
  const { t } = useTranslation('common');
  const searchParams = useSearchParams();

  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [triggers, setTriggers] = useState<SurveyTrigger[]>([]);
  const [isTemplatesLoading, setTemplatesLoading] = useState(true);
  const [isTriggersLoading, setTriggersLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [triggersError, setTriggersError] = useState<string | null>(null);

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const subtab = searchParams?.get('subtab');
    const initialLabel = subtab ? TAB_SLUG_TO_LABEL[subtab.toLowerCase()] : undefined;
    return initialLabel || 'Templates'; // Default to 'Templates'
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const subtab = searchParams?.get('subtab');
    const currentLabel = subtab ? TAB_SLUG_TO_LABEL[subtab.toLowerCase()] : undefined;
    const targetTab = currentLabel || 'Templates';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [searchParams, activeTab]);

  // Update URL when tab changes
  const handleTabChange = useCallback((tabLabel: string) => {
    setActiveTab(tabLabel);

    const urlSlug = TAB_LABEL_TO_SLUG[tabLabel];
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (urlSlug && urlSlug !== 'templates') {
      currentSearchParams.set('subtab', urlSlug);
    } else {
      currentSearchParams.delete('subtab');
    }

    // Preserve existing tab parameter (for parent settings page)
    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  }, []);

  const templateLoadErrorFallback = useMemo(
    () =>
      t('surveys.settings.templateList.errors.load', 'Unable to load survey templates.'),
    [t]
  );
  const triggerLoadErrorFallback = useMemo(
    () =>
      t('surveys.settings.triggerList.errors.load', 'Unable to load survey triggers.'),
    [t]
  );
  const loadingText = useMemo(
    () => t('surveys.common.loading', 'Loading...'),
    [t]
  );

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const data = await getSurveyTemplates();
      setTemplates(data);
      setTemplatesError(null);
    } catch (error) {
      console.error('[SurveySettings] Failed to load templates', error);
      setTemplatesError(
        error instanceof Error && error.message ? error.message : templateLoadErrorFallback
      );
    } finally {
      setTemplatesLoading(false);
    }
  }, [templateLoadErrorFallback]);

  const loadTriggers = useCallback(async () => {
    setTriggersLoading(true);
    try {
      const data = await getSurveyTriggers();
      setTriggers(data);
      setTriggersError(null);
    } catch (error) {
      console.error('[SurveySettings] Failed to load triggers', error);
      setTriggersError(
        error instanceof Error && error.message ? error.message : triggerLoadErrorFallback
      );
    } finally {
      setTriggersLoading(false);
    }
  }, [triggerLoadErrorFallback]);

  useEffect(() => {
    void loadTemplates();
    void loadTriggers();
  }, [loadTemplates, loadTriggers]);

  const templateTabLabel = t('surveys.settings.tabs.templates', 'Templates');
  const triggerTabLabel = t('surveys.settings.tabs.triggers', 'Triggers');

  const tabs = useMemo(
    () => [
      {
        label: templateTabLabel,
        content: templatesError ? (
          <Alert variant="destructive" id="survey-template-error">
            <AlertDescription>{templatesError}</AlertDescription>
          </Alert>
        ) : (
          <TemplateList
            templates={templates}
            onTemplatesChange={setTemplates}
            isLoading={isTemplatesLoading}
            onRefresh={loadTemplates}
          />
        ),
      },
      {
        label: triggerTabLabel,
        content: triggersError ? (
          <Alert variant="destructive" id="survey-trigger-error">
            <AlertDescription>{triggersError}</AlertDescription>
          </Alert>
        ) : templates.length === 0 && isTemplatesLoading ? (
          <div className="flex justify-center py-12">
            <LoadingIndicator layout="stacked" text={loadingText} />
          </div>
        ) : (
          <TriggerList
            templates={templates}
            triggers={triggers}
            onTriggersChange={setTriggers}
            isLoading={isTriggersLoading}
            onRefresh={loadTriggers}
          />
        ),
      },
    ],
    [
      templateTabLabel,
      triggerTabLabel,
      templatesError,
      triggersError,
      templates,
      isTemplatesLoading,
      loadTemplates,
      triggers,
      isTriggersLoading,
      loadTriggers,
      loadingText,
    ]
  );

  return (
    <Card className="space-y-6 p-6">
      <CardHeader className="px-0">
        <CardTitle>{t('surveys.settings.title', 'Customer Satisfaction Surveys')}</CardTitle>
        <CardDescription>
          {t(
            'surveys.settings.subtitle',
            'Configure templates, triggers, and delivery to collect post-ticket feedback.'
          )}
        </CardDescription>
      </CardHeader>
      <CustomTabs
        idPrefix="survey-settings"
        tabs={tabs}
        defaultTab={activeTab}
        onTabChange={handleTabChange}
        tabStyles={{
          root: 'w-full',
          list: 'overflow-x-auto pb-2',
          trigger: 'whitespace-nowrap',
          content: 'pt-4',
        }}
      />
    </Card>
  );
};

export default SurveySettings;
