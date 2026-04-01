'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import TemplateList from './templates/TemplateList';
import TriggerList from './triggers/TriggerList';
import {
  getSurveyTemplates,
  getSurveyTriggers,
} from '@alga-psa/surveys/actions/surveyActions';
import type { SurveyTemplate, SurveyTrigger } from '@alga-psa/surveys/actions/surveyActions';

const DEFAULT_TAB = 'templates';

const SurveySettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/surveys');
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
    return subtab?.toLowerCase() || DEFAULT_TAB;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const subtab = searchParams?.get('subtab');
    const targetTab = subtab?.toLowerCase() || DEFAULT_TAB;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [searchParams, activeTab]);

  // Update URL when tab changes
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_TAB) {
      currentSearchParams.set('subtab', tabId);
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
    () => t('settings.templateList.errors.load', { defaultValue: 'Unable to load survey templates.' }),
    [t]
  );
  const triggerLoadErrorFallback = useMemo(
    () => t('settings.triggerList.errors.load', { defaultValue: 'Unable to load survey triggers.' }),
    [t]
  );
  const loadingText = useMemo(
    () => t('common.loading', { defaultValue: 'Loading...' }),
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

  const templateTabLabel = t('settings.tabs.templates', { defaultValue: 'Templates' });
  const triggerTabLabel = t('settings.tabs.triggers', { defaultValue: 'Triggers' });

  const tabs = useMemo(
    () => [
      {
        id: 'templates',
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
        id: 'triggers',
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
        <CardTitle>{t('settings.title', { defaultValue: 'Customer Satisfaction Surveys' })}</CardTitle>
        <CardDescription>
          {t('settings.subtitle', {
            defaultValue: 'Configure templates, triggers, and delivery to collect post-ticket feedback.',
          })}
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
