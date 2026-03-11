'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Switch } from '@alga-psa/ui/components/Switch';
import { canEnableAiAssistant, getExperimentalFeatures, updateExperimentalFeatures } from '@alga-psa/tenancy/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ExperimentalFeatureKey = 'aiAssistant' | 'workflowAutomation';

type ExperimentalFeatureDefinition = {
  key: ExperimentalFeatureKey;
  name: string;
  description: string;
};

type ExperimentalFeatureState = Record<ExperimentalFeatureKey, boolean>;

const defaultExperimentalFeatureState: ExperimentalFeatureState = {
  aiAssistant: false,
  workflowAutomation: false,
};

export default function ExperimentalFeaturesSettings(): React.JSX.Element {
  const { t } = useTranslation('msp/settings');

  const experimentalFeatureDefinitions = useMemo<ExperimentalFeatureDefinition[]>(() => [
    {
      key: 'aiAssistant',
      name: t('experimentalFeatures.features.aiAssistant.name'),
      description: t('experimentalFeatures.features.aiAssistant.description'),
    },
    {
      key: 'workflowAutomation',
      name: t('experimentalFeatures.features.workflowAutomation.name'),
      description: t('experimentalFeatures.features.workflowAutomation.description'),
    },
  ], [t]);
  const [features, setFeatures] = useState<ExperimentalFeatureState>(defaultExperimentalFeatureState);
  const [savedFeatures, setSavedFeatures] = useState<ExperimentalFeatureState>(defaultExperimentalFeatureState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiAssistantAllowed, setAiAssistantAllowed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setLoadError(null);

      const [saved, aiAllowed] = await Promise.all([getExperimentalFeatures(), canEnableAiAssistant()]);
      const loaded: ExperimentalFeatureState = {
        aiAssistant: saved.aiAssistant === true,
        workflowAutomation: saved.workflowAutomation === true,
      };
      setFeatures(loaded);
      setSavedFeatures(loaded);
      setAiAssistantAllowed(aiAllowed);
    } catch (error) {
      setLoadError(t('experimentalFeatures.messages.error.loadFailed'));
      handleError(error, t('experimentalFeatures.messages.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback((key: ExperimentalFeatureKey, enabled: boolean) => {
    setFeatures((prev) => ({
      ...prev,
      [key]: enabled,
    }));
  }, []);

  const hasChanges = (Object.keys(features) as ExperimentalFeatureKey[]).some(
    (key) => features[key] !== savedFeatures[key]
  );

  const handleSave = useCallback(async (): Promise<void> => {
    try {
      setSaving(true);
      await updateExperimentalFeatures(features);
      setSavedFeatures(features);
      toast.success(t('experimentalFeatures.messages.success.saved'));
    } catch (error) {
      handleError(error, t('experimentalFeatures.messages.error.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [features, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator layout="stacked" text={t('experimentalFeatures.loading')} spinnerProps={{ size: 'md' }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-accent-500">{loadError}</p>
        <Button id="retry-load-experimental-features" onClick={load}>
          {t('experimentalFeatures.actions.retry')}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('experimentalFeatures.title')}</CardTitle>
        <CardDescription>{t('experimentalFeatures.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert variant="warning">
          <AlertTitle>{t('experimentalFeatures.alert.title')}</AlertTitle>
          <AlertDescription>{t('experimentalFeatures.alert.description')}</AlertDescription>
        </Alert>
        {experimentalFeatureDefinitions.map((feature) => (
          <div
            key={feature.key}
            className="flex items-start justify-between gap-6 rounded-md border border-gray-200 p-4"
          >
            <div className="min-w-0">
              <div className="font-medium">{feature.name}</div>
              <div className="text-sm text-gray-600">{feature.description}</div>
              {feature.key === 'aiAssistant' && !aiAssistantAllowed && (
                <div className="text-xs text-gray-500">
                  {t('experimentalFeatures.features.aiAssistant.restriction')}
                </div>
              )}
            </div>
            <Switch
              id={`experimental-feature-toggle-${feature.key}`}
              checked={features[feature.key]}
              disabled={feature.key === 'aiAssistant' && !aiAssistantAllowed}
              onCheckedChange={(checked) => handleToggle(feature.key, checked)}
            />
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <Button
            id="save-experimental-features"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving ? t('experimentalFeatures.actions.saving') : t('experimentalFeatures.actions.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
