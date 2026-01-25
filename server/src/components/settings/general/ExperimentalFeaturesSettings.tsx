'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Switch } from '@alga-psa/ui/components/Switch';
import { getExperimentalFeatures, updateExperimentalFeatures } from '@alga-psa/tenancy/actions';

type ExperimentalFeatureKey = 'aiAssistant';

type ExperimentalFeatureDefinition = {
  key: ExperimentalFeatureKey;
  name: string;
  description: string;
};

const experimentalFeatureDefinitions: ExperimentalFeatureDefinition[] = [
  {
    key: 'aiAssistant',
    name: 'AI Assistant',
    description: 'Enable AI-powered Quick Ask and Chat sidebar.',
  },
];

type ExperimentalFeatureState = Record<ExperimentalFeatureKey, boolean>;

const defaultExperimentalFeatureState: ExperimentalFeatureState = {
  aiAssistant: false,
};

export default function ExperimentalFeaturesSettings(): React.JSX.Element {
  const [features, setFeatures] = useState<ExperimentalFeatureState>(defaultExperimentalFeatureState);
  const [savedFeatures, setSavedFeatures] = useState<ExperimentalFeatureState>(defaultExperimentalFeatureState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setLoadError(null);

      const saved = await getExperimentalFeatures();
      const loaded: ExperimentalFeatureState = {
        aiAssistant: saved.aiAssistant === true,
      };
      setFeatures(loaded);
      setSavedFeatures(loaded);
    } catch (error) {
      console.error('Failed to load experimental features:', error);
      setLoadError('Failed to load experimental feature settings.');
      toast.error('Failed to load experimental feature settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback((key: ExperimentalFeatureKey, enabled: boolean) => {
    setFeatures((prev) => ({
      ...prev,
      [key]: enabled,
    }));
  }, []);

  const hasChanges = features.aiAssistant !== savedFeatures.aiAssistant;

  const handleSave = useCallback(async (): Promise<void> => {
    try {
      setSaving(true);
      await updateExperimentalFeatures({
        aiAssistant: features.aiAssistant,
      });
      setSavedFeatures(features);
      toast.success('Experimental feature settings saved. Reload the page to apply changes.');
    } catch (error) {
      console.error('Failed to save experimental features:', error);
      toast.error('Failed to save experimental feature settings');
    } finally {
      setSaving(false);
    }
  }, [features]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator layout="stacked" text="Loading experimental features..." spinnerProps={{ size: 'md' }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-accent-500">{loadError}</p>
        <Button id="retry-load-experimental-features" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Experimental Features</CardTitle>
        <CardDescription>Enable or disable experimental features for your tenant.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert
          variant="warning"
          className="text-[rgba(255,174,0,1)] [&>svg]:text-[rgba(255,174,0,1)]"
        >
          <AlertTitle>Experimental</AlertTitle>
          <AlertDescription>Experimental features may change or be removed without notice.</AlertDescription>
        </Alert>
        {experimentalFeatureDefinitions.map((feature) => (
          <div
            key={feature.key}
            className="flex items-start justify-between gap-6 rounded-md border border-gray-200 p-4"
          >
            <div className="min-w-0">
              <div className="font-medium">{feature.name}</div>
              <div className="text-sm text-gray-600">{feature.description}</div>
            </div>
            <Switch
              id={`experimental-feature-toggle-${feature.key}`}
              checked={features[feature.key]}
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
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
