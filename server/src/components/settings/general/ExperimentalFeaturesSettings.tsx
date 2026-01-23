'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Switch } from '@alga-psa/ui/components/Switch';
import { getExperimentalFeatures } from '@alga-psa/tenancy/actions';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setLoadError(null);

      const saved = await getExperimentalFeatures();
      setFeatures({
        aiAssistant: saved.aiAssistant === true,
      });
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
        <button
          onClick={load}
          className="bg-primary-500 text-white px-4 py-2 rounded hover:bg-primary-600 transition-colors"
        >
          Retry
        </button>
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
      </CardContent>
    </Card>
  );
}
