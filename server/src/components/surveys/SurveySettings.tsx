'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

const SurveySettings = (): JSX.Element => {
  const { t } = useTranslation('common');

  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [triggers, setTriggers] = useState<SurveyTrigger[]>([]);
  const [isTemplatesLoading, setTemplatesLoading] = useState(true);
  const [isTriggersLoading, setTriggersLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [triggersError, setTriggersError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const data = await getSurveyTemplates();
      setTemplates(data);
      setTemplatesError(null);
    } catch (error) {
      console.error('[SurveySettings] Failed to load templates', error);
      const fallbackError = t(
        'surveys.settings.templateList.errors.load',
        'Unable to load survey templates.'
      );
      setTemplatesError(
        error instanceof Error && error.message ? error.message : fallbackError
      );
    } finally {
      setTemplatesLoading(false);
    }
  }, [t]);

  const loadTriggers = useCallback(async () => {
    setTriggersLoading(true);
    try {
      const data = await getSurveyTriggers();
      setTriggers(data);
      setTriggersError(null);
    } catch (error) {
      console.error('[SurveySettings] Failed to load triggers', error);
      const fallbackError = t(
        'surveys.settings.triggerList.errors.load',
        'Unable to load survey triggers.'
      );
      setTriggersError(
        error instanceof Error && error.message ? error.message : fallbackError
      );
    } finally {
      setTriggersLoading(false);
    }
  }, [t]);

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
            <LoadingIndicator
              layout="stacked"
              text={t('surveys.common.loading', 'Loading...')}
            />
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
      t,
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
        defaultTab={templateTabLabel}
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
