'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { toast } from 'react-hot-toast';
import { Switch } from '@/components/ui/Switch';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import CustomSelect from '@/components/ui/CustomSelect';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import {
  fetchExtensionById,
  getExtensionSecretsMetadata,
  getExtensionSettings,
  resetExtensionSettings,
  updateExtensionSecrets,
  updateExtensionSettings,
} from '../../../lib/actions/extensionActions';
import { Extension, ExtensionSettingDefinition, ExtensionSettingType } from '../../../lib/extensions/types';

// Local helper to attach automation IDs consistently (data attribute only)
const automationId = (id: string) => ({ 'data-automation-id': id });

export default function ExtensionSettings() {
  const params = useParams();
  const router = useRouter();
  const extensionId = params?.id as string;
  
  const [isLoading, setIsLoading] = useState(true);
  const [settingsData, setSettingsData] = useState<Record<string, any>>({});
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [secretChanged, setSecretChanged] = useState(false);
  const [extension, setExtension] = useState<Extension | null>(null);
  const [hasStoredSecrets, setHasStoredSecrets] = useState(false);
  const [secretsVersion, setSecretsVersion] = useState<string | null>(null);
  
  const allSettingDefinitions = useMemo(() => {
    return extension?.manifest?.settings || [];
  }, [extension]);

  const configSettingDefinitions = useMemo(
    () => allSettingDefinitions.filter((definition) => !definition.encrypted),
    [allSettingDefinitions]
  );

  const secretDefinitions = useMemo(
    () => allSettingDefinitions.filter((definition) => definition.encrypted),
    [allSettingDefinitions]
  );
  
  // Group settings by category
  const settingsByCategory = useMemo(() => {
    const grouped: Record<string, ExtensionSettingDefinition[]> = {
      'General': []
    };
    
    configSettingDefinitions.forEach(setting => {
      const category = setting.category || 'General';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(setting);
    });
    
    return grouped;
  }, [configSettingDefinitions]);
  
  // Categories for tabs
  const categories = useMemo(() => {
    return Object.keys(settingsByCategory);
  }, [settingsByCategory]);
  
  // Track active tab for controlled Tabs (must be before any early returns)
  const [activeTab, setActiveTab] = useState<string>('');
  useEffect(() => {
    if (categories.length > 0) {
      setActiveTab((prev) => (prev && categories.includes(prev) ? prev : categories[0]));
    }
  }, [categories]);

  // Load extension and settings data
  useEffect(() => {
    const loadExtensionAndSettings = async () => {
      setIsLoading(true);
      
      try {
        // Load extension data
        const extensionData = await fetchExtensionById(extensionId);
        if (!extensionData) {
          setExtension(null);
          setIsLoading(false);
          return;
        }
        
        setExtension(extensionData);

        const manifestSettings = extensionData.manifest.settings || [];
        const configDefs = manifestSettings.filter((definition) => !definition.encrypted);
        const secretDefs = manifestSettings.filter((definition) => definition.encrypted);

        const [savedSettings, metadata] = await Promise.all([
          getExtensionSettings(extensionId),
          getExtensionSecretsMetadata(extensionId),
        ]);

        const initialSettings: Record<string, any> = {};
        configDefs.forEach((def) => {
          const defaultValue = def.defaultValue ?? def.default ?? null;
          initialSettings[def.key] =
            savedSettings?.[def.key] !== undefined ? savedSettings[def.key] : defaultValue;
        });

        const initialSecrets: Record<string, string> = {};
        secretDefs.forEach((def) => {
          initialSecrets[def.key] = '';
        });

        setSettingsData(initialSettings);
        setSecretValues(initialSecrets);
        setHasChanges(false);
        setSecretChanged(false);
        setHasStoredSecrets(Boolean(metadata?.hasEnvelope));
        setSecretsVersion(metadata?.secretsVersion ?? null);
      } catch (error) {
        console.error('Failed to load extension settings', error);
        toast.error('Failed to load extension settings.');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadExtensionAndSettings();
  }, [extensionId]);
  
  // Handle settings change
  const handleSettingChange = (key: string, value: any) => {
    setSettingsData(prev => ({
      ...prev,
      [key]: value,
    }));
    setHasChanges(true);
  };

  const handleSecretChange = (key: string, value: string) => {
    setSecretValues((prev) => ({
      ...prev,
      [key]: value,
    }));
    setSecretChanged(true);
  };
  
  // Save settings
  const handleSaveSettings = async () => {
    if (secretDefinitions.length > 0 && !hasStoredSecrets) {
      const missingRequired = secretDefinitions.filter(
        (definition) => definition.required && !secretValues[definition.key]
      );
      if (missingRequired.length > 0) {
        toast.error('Please provide values for required secrets before saving.');
        return;
      }
      const hasAnySecretInput = Object.values(secretValues).some((value) => value && value.length > 0);
      if (!hasAnySecretInput) {
        toast.error('Enter secret values before saving.');
        return;
      }
    }

    setIsLoading(true);

    try {
      const shouldUpdateConfig = hasChanges;
      let configMessage: string | null = null;

      if (shouldUpdateConfig) {
        const updateResult = await updateExtensionSettings(extensionId, settingsData);
        if (!updateResult.success) {
          toast.error(updateResult.message || 'Failed to save extension settings.');
          return;
        }
        configMessage = updateResult.message || 'Extension settings saved successfully.';
      }

      const secretsPayload = secretDefinitions.reduce<Record<string, string>>((acc, definition) => {
        const raw = secretValues[definition.key] ?? '';
        const trimmed = typeof raw === 'string' ? raw : '';
        if (trimmed.length > 0) {
          acc[definition.key] = trimmed;
        }
        return acc;
      }, {});

      if (secretDefinitions.length > 0 && (Object.keys(secretsPayload).length > 0 || !hasStoredSecrets)) {
        const secretResult = await updateExtensionSecrets(extensionId, secretsPayload);
        if (!secretResult.success) {
          toast.error(secretResult.message || 'Failed to update extension secrets.');
          return;
        }
        toast.success(secretResult.message || 'Extension secrets updated.');
        const metadata = await getExtensionSecretsMetadata(extensionId);
        setHasStoredSecrets(Boolean(metadata?.hasEnvelope));
        setSecretsVersion(metadata?.secretsVersion ?? null);
        setSecretValues(
          secretDefinitions.reduce<Record<string, string>>((acc, definition) => {
            acc[definition.key] = '';
            return acc;
          }, {})
        );
        setSecretChanged(false);
      }

      if (configMessage) {
        toast.success(configMessage);
      }
      if (!configMessage && !(secretDefinitions.length > 0 && (Object.keys(secretsPayload).length > 0 || !hasStoredSecrets))) {
        toast.success('Extension settings saved successfully.');
      }
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save extension settings', error);
      toast.error('Failed to save extension settings.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Reset settings to defaults
  const handleResetToDefaults = async () => {
    if (!confirm('Are you sure you want to reset all settings to their default values?')) {
      return;
    }
    
    setIsLoading(true);
    
    try {
      const result = await resetExtensionSettings(extensionId);
      
      if (!result.success) {
        toast.error(result.message || 'Failed to reset extension settings.');
        return;
      }
      
      // Reset local state to defaults
      const defaultSettings: Record<string, any> = {};
      configSettingDefinitions.forEach(def => {
        defaultSettings[def.key] = def.defaultValue !== undefined ? def.defaultValue : def.default ?? null;
      });

      setSettingsData(defaultSettings);
      setHasChanges(false);
      setSecretValues(
        secretDefinitions.reduce<Record<string, string>>((acc, definition) => {
          acc[definition.key] = '';
          return acc;
        }, {})
      );
      setSecretChanged(false);
      
      toast.success('Settings reset to default values.');
    } catch (error) {
      console.error('Failed to reset extension settings', error);
      toast.error('Failed to reset extension settings.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Render setting input based on type
  const renderSettingInput = (setting: ExtensionSettingDefinition) => {
    const { key, type, options, placeholder } = setting;
    const value = settingsData[key];
    const automationIdProps = automationId(`extension-setting-${key}`);
    
    switch (type) {
      case 'string':
        return (
          <Input
            id={`setting-${key}`}
            value={value || ''}
            placeholder={placeholder || ''}
            onChange={(e) => handleSettingChange(key, e.target.value)}
            className="max-w-md"
            {...automationIdProps}
          />
        );
        
      case 'text':
        return (
          <TextArea
            id={`setting-${key}`}
            value={value || ''}
            placeholder={placeholder || ''}
            onChange={(e) => handleSettingChange(key, e.target.value)}
            className="max-w-md"
            {...automationIdProps}
          />
        );
        
      case 'number':
        return (
          <Input
            id={`setting-${key}`}
            type="number"
            value={value === null ? '' : value}
            placeholder={placeholder || ''}
            onChange={(e) => handleSettingChange(key, Number(e.target.value))}
            className="max-w-md"
            {...automationIdProps}
          />
        );
        
      case 'boolean':
        return (
          <Switch
            id={`setting-${key}`}
            checked={Boolean(value)}
            onCheckedChange={(checked) => handleSettingChange(key, checked)}
            {...automationIdProps}
          />
        );
        
      case 'select':
        return (
          <CustomSelect
            options={(options || []).map((opt) => ({ value: opt.value.toString(), label: opt.label }))}
            value={value || ''}
            onValueChange={(val) => handleSettingChange(key, val)}
            placeholder={placeholder || 'Select an option'}
            className="max-w-md"
            {...automationIdProps}
          />
        );
        
      default:
        return (
          <Input
            value={value || ''}
            placeholder={placeholder || ''}
            onChange={(e) => handleSettingChange(key, e.target.value)}
            className="max-w-md"
            {...automationIdProps}
          />
        );
    }
  };
  
  if (!extension) {
    return (
      <div className="p-6">
        <div className="text-center">
          <h2 className="text-xl font-medium">Extension not found</h2>
          <p className="text-gray-500 mt-2">The extension you're looking for doesn't exist or you don't have access to it.</p>
          <Button
            id="back-to-extensions-button"
            variant="outline"
            className="mt-4"
            onClick={() => router.push('/msp/settings/extensions')}
          >
            Back to Extensions
          </Button>
        </div>
      </div>
    );
  }
  
  const automationIdProps = automationId(`extension-settings-${extensionId}`);

  return (
    <ReflectionContainer id={`extension-settings-${extensionId}`} label="Extension Settings">
      <div className="p-6" {...automationIdProps}>
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center">
            <Button
              id="back-to-extension-button"
              variant="ghost"
              size="sm"
              className="mr-2"
              onClick={() => router.push(`/msp/settings/extensions/${extensionId}`)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-semibold text-gray-900">
              {extension.name} Settings
            </h1>
          </div>
          
          <div className="flex gap-2">
            <Button 
              id="reset-to-defaults-button"
              variant="outline" 
              onClick={handleResetToDefaults}
              disabled={isLoading}
            >
              Reset to Defaults
            </Button>
            <Button 
              id="save-settings-button"
              onClick={handleSaveSettings}
              disabled={isLoading || (!hasChanges && !secretChanged)}
            >
              Save Changes
            </Button>
          </div>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Extension Settings</CardTitle>
            <CardDescription>
              Configure settings for this extension. These settings will be used by the extension to customize its behavior.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {configSettingDefinitions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">This extension doesn't have any configurable settings.</p>
              </div>
            ) : (
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  {categories.map((category) => (
                    <TabsTrigger key={category} value={category}>
                      {category}
                    </TabsTrigger>
                  ))}
                </TabsList>
                
                {categories.map((category) => (
                  <TabsContent key={category} value={category}>
                    <div className="space-y-6">
                      {settingsByCategory[category].map((setting) => (
                        <div key={setting.key} className="grid gap-2">
                          <div className="flex items-center justify-between">
                            <label 
                              htmlFor={`setting-${setting.key}`}
                              className="text-sm font-medium"
                            >
                              {setting.label || setting.key}
                              {setting.required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                          </div>
                          {setting.description && (
                            <p className="text-sm text-gray-500 mb-1">{setting.description}</p>
                          )}
                          {renderSettingInput(setting)}
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </CardContent>
        </Card>

        {secretDefinitions.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Secret Values</CardTitle>
              <CardDescription>
                Secrets are encrypted at rest. {hasStoredSecrets ? 'Leave a field blank to keep the existing secret.' : 'Provide values for required secrets before saving.'}
                {secretsVersion && (
                  <span className="ml-2 text-xs text-gray-500">Version: {secretsVersion}</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {secretDefinitions.map((secret) => {
                  const automationProps = automationId(`extension-secret-${secret.key}`)
                  const value = secretValues[secret.key] ?? ''
                  return (
                    <div key={secret.key} className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <label htmlFor={`secret-${secret.key}`} className="text-sm font-medium">
                          {secret.label || secret.key}
                          {secret.required && <span className="text-red-500 ml-1">*</span>}
                        </label>
                      </div>
                      {secret.description && (
                        <p className="text-sm text-gray-500 mb-1">{secret.description}</p>
                      )}
                      <Input
                        id={`secret-${secret.key}`}
                        type="password"
                        autoComplete="new-password"
                        value={value}
                        placeholder={secret.placeholder || 'Enter secret value'}
                        onChange={(e) => handleSecretChange(secret.key, e.target.value)}
                        className="max-w-md"
                        {...automationProps}
                      />
                      {hasStoredSecrets && (
                        <p className="text-xs text-gray-500">
                          Stored secret present. Enter a new value to rotate.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ReflectionContainer>
  );
}
