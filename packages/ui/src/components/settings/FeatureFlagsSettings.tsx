'use client';

import { useTranslation } from '../../lib/i18n/client';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useFeatureFlags } from '../../hooks/useFeatureFlag';
import { Shield, Zap, Users, FlaskRoundIcon as Flask, Settings, TrendingUp } from 'lucide-react';

interface FeatureCategory {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<any>;
  features: FeatureDefinition[];
}

interface FeatureDefinition {
  key: string;
  name: string;
  description: string;
  category: 'stable' | 'beta' | 'experimental';
  requiresRestart?: boolean;
  dependencies?: string[];
}

function useFeatureCategories(): FeatureCategory[] {
  const { t } = useTranslation('msp/settings');
  return [
    {
      id: 'core',
      name: t('featureFlags.categories.core.title'),
      description: t('featureFlags.categories.core.description'),
      icon: Shield,
      features: [
        {
          key: 'enable_ticket_automation',
          name: t('featureFlags.features.enable_ticket_automation.title'),
          description: t('featureFlags.features.enable_ticket_automation.description'),
          category: 'stable',
        },
        {
          key: 'enable_time_tracking',
          name: t('featureFlags.features.enable_time_tracking.title'),
          description: t('featureFlags.features.enable_time_tracking.description'),
          category: 'stable',
        },
        {
          key: 'enable_billing',
          name: t('featureFlags.features.enable_billing.title'),
          description: t('featureFlags.features.enable_billing.description'),
          category: 'stable',
        },
      ],
    },
    {
      id: 'ui',
      name: t('featureFlags.categories.ui.title'),
      description: t('featureFlags.categories.ui.description'),
      icon: Zap,
      features: [
        {
          key: 'new_ticket_ui',
          name: t('featureFlags.features.new_ticket_ui.title'),
          description: t('featureFlags.features.new_ticket_ui.description'),
          category: 'beta',
        },
        {
          key: 'new_dashboard_layout',
          name: t('featureFlags.features.new_dashboard_layout.title'),
          description: t('featureFlags.features.new_dashboard_layout.description'),
          category: 'beta',
        },
      ],
    },
    {
      id: 'ai',
      name: t('featureFlags.categories.ai.title'),
      description: t('featureFlags.categories.ai.description'),
      icon: TrendingUp,
      features: [
        {
          key: 'ai_ticket_suggestions',
          name: t('featureFlags.features.ai_ticket_suggestions.title'),
          description: t('featureFlags.features.ai_ticket_suggestions.description'),
          category: 'experimental',
        },
        {
          key: 'enable_ai_time_tracking',
          name: t('featureFlags.features.enable_ai_time_tracking.title'),
          description: t('featureFlags.features.enable_ai_time_tracking.description'),
          category: 'experimental',
        },
        {
          key: 'enable_predictive_analytics',
          name: t('featureFlags.features.enable_predictive_analytics.title'),
          description: t('featureFlags.features.enable_predictive_analytics.description'),
          category: 'experimental',
        },
      ],
    },
    {
      id: 'integrations',
      name: t('featureFlags.categories.integrations.title'),
      description: t('featureFlags.categories.integrations.description'),
      icon: Users,
      features: [
        {
          key: 'enable_slack_integration',
          name: t('featureFlags.features.enable_slack_integration.title'),
          description: t('featureFlags.features.enable_slack_integration.description'),
          category: 'stable',
        },
        {
          key: 'teams-integration-ui',
          name: 'Microsoft Teams',
          description: t('featureFlags.features.teams-integration-ui.description'),
          category: 'stable',
        },
        {
          key: 'enable_jira_sync',
          name: t('featureFlags.features.enable_jira_sync.title'),
          description: t('featureFlags.features.enable_jira_sync.description'),
          category: 'beta',
        },
      ],
    },
    {
      id: 'performance',
      name: t('featureFlags.categories.performance.title'),
      description: t('featureFlags.categories.performance.description'),
      icon: Settings,
      features: [
        {
          key: 'enable_query_caching',
          name: t('featureFlags.features.enable_query_caching.title'),
          description: t('featureFlags.features.enable_query_caching.description'),
          category: 'stable',
        },
        {
          key: 'enable_lazy_loading',
          name: t('featureFlags.features.enable_lazy_loading.title'),
          description: t('featureFlags.features.enable_lazy_loading.description'),
          category: 'stable',
        },
        {
          key: 'enable_websocket_updates',
          name: t('featureFlags.features.enable_websocket_updates.title'),
          description: t('featureFlags.features.enable_websocket_updates.description'),
          category: 'beta',
          requiresRestart: true,
        },
      ],
    },
    {
      id: 'experimental',
      name: t('featureFlags.categories.experimental.title'),
      description: t('featureFlags.categories.experimental.description'),
      icon: Flask,
      features: [
        {
          key: 'enable_voice_commands',
          name: t('featureFlags.features.enable_voice_commands.title'),
          description: t('featureFlags.features.enable_voice_commands.description'),
          category: 'experimental',
        },
        {
          key: 'beta_mobile_app',
          name: t('featureFlags.features.beta_mobile_app.title'),
          description: t('featureFlags.features.beta_mobile_app.description'),
          category: 'experimental',
        },
      ],
    },
  ];
}

export function FeatureFlagsSettings() {
  const { t } = useTranslation('msp/settings');
  const { t: tCommon } = useTranslation('common');
  const featureCategories = useFeatureCategories();
  const { flags, loading, error } = useFeatureFlags();
  const [localFlags, setLocalFlags] = useState<Record<string, boolean>>({});
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('core');

  useEffect(() => {
    if (flags) {
      const booleanFlags = Object.entries(flags).reduce((acc, [key, value]) => {
        if (typeof value === 'boolean') {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, boolean>);
      setLocalFlags(booleanFlags);
    }
  }, [flags]);

  const handleToggle = (key: string) => {
    setLocalFlags(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
    setUnsavedChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // In a real implementation, this would save to a backend
      // For now, we'll just simulate a save
      await new Promise(resolve => setTimeout(resolve, 1000));
      setUnsavedChanges(false);
    } catch (error) {
      console.error('Error saving feature flags:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (flags) {
      const booleanFlags = Object.entries(flags).reduce((acc, [key, value]) => {
        if (typeof value === 'boolean') {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, boolean>);
      setLocalFlags(booleanFlags);
      setUnsavedChanges(false);
    }
  };

  const getCategoryBadge = (category: FeatureDefinition['category']) => {
    switch (category) {
      case 'stable':
        return <Badge variant="success">{t('featureFlags.enums.stable')}</Badge>;
      case 'beta':
        return <Badge variant="warning">{t('featureFlags.enums.beta')}</Badge>;
      case 'experimental':
        return <Badge variant="error">{t('featureFlags.enums.experimental')}</Badge>;
    }
  };

  if (loading) {
    return <div>{t('featureFlags.loading')}</div>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {t('featureFlags.errors.loadFailed', { message: error.message })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('featureFlags.title')}</h2>
        <p className="text-muted-foreground">
          {t('featureFlags.description')}
        </p>
      </div>

      {unsavedChanges && (
        <Alert>
          <AlertDescription>
            {t('featureFlags.unsaved')}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
            <TabsList className="w-full justify-start rounded-none border-b">
              {featureCategories.map(category => {
                const Icon = category.icon;
                return (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="flex items-center space-x-2"
                  >
                    <Icon className="h-4 w-4" />
                    <span>{category.name}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {featureCategories.map(category => (
              <TabsContent key={category.id} value={category.id} className="p-6">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">{category.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {category.description}
                    </p>
                  </div>

                  <div className="space-y-4">
                    {category.features.map(feature => (
                      <Card key={feature.key} className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center space-x-2">
                              <Label htmlFor={feature.key} className="text-base font-medium">
                                {feature.name}
                              </Label>
                              {getCategoryBadge(feature.category)}
                              {feature.requiresRestart && (
                                <Badge variant="default">{t('featureFlags.requiresRestart')}</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {feature.description}
                            </p>
                            {feature.dependencies && feature.dependencies.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                {t('featureFlags.dependencies', { dependencies: feature.dependencies.join(', ') })}
                              </p>
                            )}
                          </div>
                          <Switch
                            id={feature.key}
                            checked={localFlags[feature.key] || false}
                            onCheckedChange={() => handleToggle(feature.key)}
                            className="ml-4"
                          />
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <div className="flex justify-end space-x-2">
        <Button
          id="reset-feature-flags"
          variant="outline"
          onClick={handleReset}
          disabled={!unsavedChanges || saving}
        >
          {tCommon('actions.reset')}
        </Button>
        <Button
          id="save-feature-flags"
          onClick={handleSave}
          disabled={!unsavedChanges || saving}
        >
          {saving ? tCommon('actions.saving') : tCommon('actions.saveChanges')}
        </Button>
      </div>
    </div>
  );
}