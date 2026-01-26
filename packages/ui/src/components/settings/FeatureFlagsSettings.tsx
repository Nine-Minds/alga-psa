'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../Card';
import { Switch } from '../Switch';
import { Label } from '../Label';
import { Button } from '../Button';
import { Alert, AlertDescription } from '../Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../Tabs';
import { Badge } from '../Badge';
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

const featureCategories: FeatureCategory[] = [
  {
    id: 'core',
    name: 'Core Features',
    description: 'Essential features for daily operations',
    icon: Shield,
    features: [
      {
        key: 'enable_ticket_automation',
        name: 'Ticket Automation',
        description: 'Automatically assign and route tickets based on rules',
        category: 'stable',
      },
      {
        key: 'enable_time_tracking',
        name: 'Time Tracking',
        description: 'Track time spent on tickets and projects',
        category: 'stable',
      },
      {
        key: 'enable_billing',
        name: 'Billing System',
        description: 'Invoice generation and payment tracking',
        category: 'stable',
      },
    ],
  },
  {
    id: 'ui',
    name: 'User Interface',
    description: 'New UI features and improvements',
    icon: Zap,
    features: [
      {
        key: 'new_ticket_ui',
        name: 'New Ticket Interface',
        description: 'Redesigned ticket creation and management UI',
        category: 'beta',
      },
      {
        key: 'new_dashboard_layout',
        name: 'Modern Dashboard',
        description: 'New dashboard with customizable widgets',
        category: 'beta',
      },
    ],
  },
  {
    id: 'ai',
    name: 'AI Features',
    description: 'Artificial intelligence powered features',
    icon: TrendingUp,
    features: [
      {
        key: 'ai_ticket_suggestions',
        name: 'AI Ticket Suggestions',
        description: 'AI-powered ticket categorization and priority suggestions',
        category: 'experimental',
      },
      {
        key: 'enable_ai_time_tracking',
        name: 'AI Time Tracking',
        description: 'Automatically track time based on activity',
        category: 'experimental',
      },
      {
        key: 'enable_predictive_analytics',
        name: 'Predictive Analytics',
        description: 'Predict ticket volume and resource needs',
        category: 'experimental',
      },
    ],
  },
  {
    id: 'integrations',
    name: 'Integrations',
    description: 'Third-party service integrations',
    icon: Users,
    features: [
      {
        key: 'enable_slack_integration',
        name: 'Slack Integration',
        description: 'Send notifications and updates to Slack',
        category: 'stable',
      },
      {
        key: 'enable_teams_integration',
        name: 'Microsoft Teams',
        description: 'Integrate with Microsoft Teams',
        category: 'stable',
      },
      {
        key: 'enable_jira_sync',
        name: 'Jira Sync',
        description: 'Sync tickets with Jira issues',
        category: 'beta',
      },
    ],
  },
  {
    id: 'performance',
    name: 'Performance',
    description: 'Performance optimization features',
    icon: Settings,
    features: [
      {
        key: 'enable_query_caching',
        name: 'Query Caching',
        description: 'Cache database queries for faster response times',
        category: 'stable',
      },
      {
        key: 'enable_lazy_loading',
        name: 'Lazy Loading',
        description: 'Load content as needed for better performance',
        category: 'stable',
      },
      {
        key: 'enable_websocket_updates',
        name: 'Real-time Updates',
        description: 'Use WebSockets for instant updates',
        category: 'beta',
        requiresRestart: true,
      },
    ],
  },
  {
    id: 'experimental',
    name: 'Experimental',
    description: 'Cutting-edge features in development',
    icon: Flask,
    features: [
      {
        key: 'enable_voice_commands',
        name: 'Voice Commands',
        description: 'Control the app with voice commands',
        category: 'experimental',
      },
      {
        key: 'beta_mobile_app',
        name: 'Mobile App Beta',
        description: 'Access to beta mobile application',
        category: 'experimental',
      },
    ],
  },
];

export function FeatureFlagsSettings() {
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
        return <Badge variant="success">Stable</Badge>;
      case 'beta':
        return <Badge variant="warning">Beta</Badge>;
      case 'experimental':
        return <Badge variant="error">Experimental</Badge>;
    }
  };

  if (loading) {
    return <div>Loading feature flags...</div>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Error loading feature flags: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Feature Flags</h2>
        <p className="text-muted-foreground">
          Enable or disable features across your application. Some features may require a restart.
        </p>
      </div>

      {unsavedChanges && (
        <Alert>
          <AlertDescription>
            You have unsaved changes. Click Save to apply them.
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
                                <Badge variant="default">Requires restart</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {feature.description}
                            </p>
                            {feature.dependencies && feature.dependencies.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Requires: {feature.dependencies.join(', ')}
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
          Reset
        </Button>
        <Button
          id="save-feature-flags"
          onClick={handleSave}
          disabled={!unsavedChanges || saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}