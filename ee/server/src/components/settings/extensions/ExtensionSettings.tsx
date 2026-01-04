'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Plus, Trash2, Lock, Eye, EyeOff } from 'lucide-react';
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
  getExtensionApiEndpoints,
  getExtensionSecretsMetadata,
  getExtensionSettings,
  resetExtensionSettings,
  updateExtensionSecrets,
  updateExtensionSettings,
} from '../../../lib/actions/extensionActions';
import {
  createExtensionSchedule,
  deleteExtensionSchedule,
  getDefaultScheduleTimezone,
  listExtensionSchedules,
  runExtensionScheduleNow,
  updateExtensionSchedule,
} from '../../../lib/actions/extensionScheduleActions';
import { Extension, ExtensionSettingDefinition, ExtensionSettingType } from '../../../lib/extensions/types';

const STORED_SECRET_PLACEHOLDER = '__STORED_SECRET_DO_NOT_CHANGE__';

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
  const [customSettings, setCustomSettings] = useState<Array<{ id: string; key: string; value: string; isSensitive: boolean }>>([]);
  const [apiEndpoints, setApiEndpoints] = useState<Array<{ id: string; method: string; path: string; handler: string }>>([]);
  const [schedules, setSchedules] = useState<Array<any>>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [newScheduleEndpointId, setNewScheduleEndpointId] = useState<string>('');
  const [newScheduleCron, setNewScheduleCron] = useState<string>('0 0 * * *');
  const [newScheduleTimezone, setNewScheduleTimezone] = useState<string>('UTC');
  const [newSchedulePayload, setNewSchedulePayload] = useState<string>('');
  const didTouchScheduleTimezoneRef = useRef(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editEndpointId, setEditEndpointId] = useState<string>('');
  const [editCron, setEditCron] = useState<string>('');
  const [editTimezone, setEditTimezone] = useState<string>('UTC');
  const [editPayload, setEditPayload] = useState<string>('');

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
        const manifestKeys = new Set(configDefs.map((d) => d.key));

        configDefs.forEach((def) => {
          const defaultValue = def.defaultValue ?? def.default ?? null;
          initialSettings[def.key] =
            savedSettings?.[def.key] !== undefined ? savedSettings[def.key] : defaultValue;
        });

        // Identify custom settings (those not in manifest)
        const initialCustomSettings: Array<{ id: string; key: string; value: string; isSensitive: boolean }> = [];

        let customSecretKeys: string[] = [];
        try {
          const rawKeys = savedSettings?.['_custom_secret_keys'];
          if (typeof rawKeys === 'string') {
            customSecretKeys = JSON.parse(rawKeys);
          } else if (Array.isArray(rawKeys)) {
            customSecretKeys = rawKeys;
          }
        } catch (e) {
          console.warn('Failed to parse custom secret keys', e);
        }

        if (savedSettings) {
          Object.entries(savedSettings).forEach(([key, value]) => {
            if (!manifestKeys.has(key) && key !== '_custom_secret_keys') {
              initialCustomSettings.push({
                id: Math.random().toString(36).substring(2, 9),
                key,
                value: String(value ?? ''),
                isSensitive: false,
              });
            }
          });
        }

        // Restore custom secret placeholders
        customSecretKeys.forEach((key) => {
          initialCustomSettings.push({
            id: Math.random().toString(36).substring(2, 9),
            key,
            value: STORED_SECRET_PLACEHOLDER,
            isSensitive: true,
          });
        });

        const initialSecrets: Record<string, string> = {};
        secretDefs.forEach((def) => {
          initialSecrets[def.key] = '';
        });

        setSettingsData(initialSettings);
        setCustomSettings(initialCustomSettings);
        setSecretValues(initialSecrets);
        setHasChanges(false);
        setSecretChanged(false);
        setHasStoredSecrets(Boolean(metadata?.hasEnvelope));
        setSecretsVersion(metadata?.secretsVersion ?? null);

        // Load endpoints + schedules for scheduled tasks UI (best-effort; do not block settings load).
        try {
          setSchedulesLoading(true);
          setSchedulesError(null);
          const [endpoints, scheduleRows] = await Promise.all([
            getExtensionApiEndpoints(extensionId),
            listExtensionSchedules(extensionId),
          ]);
          setApiEndpoints(endpoints);
          setSchedules(scheduleRows);

          // Best-effort: default timezone to the current user's timezone (fallback UTC).
          try {
            const tz = await getDefaultScheduleTimezone();
            if (!didTouchScheduleTimezoneRef.current && tz && tz !== 'UTC') {
              setNewScheduleTimezone(tz);
            }
          } catch {
            // Ignore; keep UTC default.
          }
        } catch (scheduleErr) {
          console.warn('Failed to load extension schedules', scheduleErr);
          const msg = scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr);
          setSchedulesError(msg || 'Failed to load schedules');
        } finally {
          setSchedulesLoading(false);
        }
      } catch (error) {
        console.error('Failed to load extension settings', error);
        toast.error('Failed to load extension settings.');
      } finally {
        setIsLoading(false);
      }
    };

    loadExtensionAndSettings();
  }, [extensionId]);

  const refreshSchedules = async () => {
    try {
      setSchedulesLoading(true);
      setSchedulesError(null);
      const [endpoints, scheduleRows] = await Promise.all([
        getExtensionApiEndpoints(extensionId),
        listExtensionSchedules(extensionId),
      ]);
      setApiEndpoints(endpoints);
      setSchedules(scheduleRows);
    } catch (e) {
      console.error('Failed to refresh schedules', e);
      const msg = e instanceof Error ? e.message : String(e);
      setSchedulesError(msg || 'Failed to refresh schedules');
      toast.error(msg || 'Failed to refresh schedules.');
    } finally {
      setSchedulesLoading(false);
    }
  };

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

  // Custom settings handlers
  const handleAddCustomSetting = () => {
    setCustomSettings((prev) => [
      ...prev,
      { id: Math.random().toString(36).substring(2, 9), key: '', value: '', isSensitive: false },
    ]);
    setHasChanges(true);
  };

  const handleRemoveCustomSetting = (id: string) => {
    setCustomSettings((prev) => prev.filter((item) => item.id !== id));
    setHasChanges(true);
  };

  const handleCustomSettingChange = (id: string, field: 'key' | 'value', newValue: string) => {
    setCustomSettings((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: newValue } : item))
    );
    setHasChanges(true);
  };

  const handleCustomSettingToggleSensitive = (id: string) => {
    setCustomSettings((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const newIsSensitive = !item.isSensitive;
        let newValue = item.value;
        if (!newIsSensitive && newValue === STORED_SECRET_PLACEHOLDER) {
          newValue = '';
        }
        return { ...item, isSensitive: newIsSensitive, value: newValue };
      })
    );
    setHasChanges(true);
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

      // Validate custom keys
      const invalidKeys = customSettings.filter(
        (item) => item.key.trim().length > 0 && !/^[a-zA-Z0-9_.-]+$/.test(item.key.trim())
      );

      if (invalidKeys.length > 0) {
        toast.error('Custom keys can only contain letters, numbers, underscores, dots, and dashes.');
        return;
      }

      // Prepare merged settings (manifest + custom non-sensitive)
      const mergedSettings = { ...settingsData };
      const customSecretKeys: string[] = [];

      customSettings.forEach((item) => {
        const key = item.key.trim();
        if (key.length > 0) {
          if (item.isSensitive) {
            if (item.value.length > 0) {
              // Only add to secrets payload if value is provided (rotation)
            }
            customSecretKeys.push(key);
          } else {
            mergedSettings[key] = item.value;
          }
        }
      });

      // Always save the list of custom secret keys so we can restore the UI
      if (customSecretKeys.length > 0) {
        mergedSettings['_custom_secret_keys'] = customSecretKeys;
      }

      console.log('Saving settings:', { hasChanges, customSecretKeys, mergedSettings });

      // Determine if we need to update config (manifest settings changed OR custom settings changed OR secret keys list needs saving)
      if (hasChanges || customSecretKeys.length > 0) {
        const updateResult = await updateExtensionSettings(extensionId, mergedSettings);
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

      // Add sensitive custom settings to secrets payload
      customSettings.forEach((item) => {
        if (
          item.key &&
          item.key.trim().length > 0 &&
          item.isSensitive &&
          item.value.length > 0 &&
          item.value !== STORED_SECRET_PLACEHOLDER
        ) {
          secretsPayload[item.key.trim()] = item.value;
        }
      });

      const hasSecretsToSave = Object.keys(secretsPayload).length > 0;
      // We should save if we have new secrets (custom or manifest) OR if we have existing manifest secrets that might need clearing/updating (though clearing is handled by empty payload usually, but here we check for existence).
      // Actually, if we have ANY secrets in payload, we must save.
      // If we have NO secrets in payload, but we have stored secrets (manifest ones), we might be clearing them?
      // The original logic was: `if (secretDefinitions.length > 0 && (Object.keys(secretsPayload).length > 0 || !hasStoredSecrets))`
      // This implies: if there are manifest secrets AND (we have values OR we don't have stored secrets yet).
      // We need to extend this to: if (hasSecretsToSave || (secretDefinitions.length > 0 && !hasStoredSecrets))

      if (hasSecretsToSave || (secretDefinitions.length > 0 && !hasStoredSecrets)) {
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
      setCustomSettings([]); // Clear custom settings on reset
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

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Custom Configuration</CardTitle>
            <CardDescription>
              Add custom configuration values for this extension. These are provided to the extension
              alongside the settings defined above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {customSettings.length === 0 ? (
              <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-lg mb-4">
                <p className="text-gray-500 mb-2">No custom configuration entries.</p>
                <Button
                  id="add-custom-setting-empty-button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddCustomSetting}
                  className="mt-2"
                  data-automation-id="add-custom-setting-empty"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Entry
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {customSettings.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className="flex-1">
                      <Input
                        placeholder="Key (e.g. MY_API_KEY)"
                        value={item.key}
                        onChange={(e) => handleCustomSettingChange(item.id, 'key', e.target.value)}
                        data-automation-id={`custom-setting-key-${item.id}`}
                      />
                    </div>
                    <div className="flex-1 relative">
                      <Input
                        type={item.isSensitive ? 'password' : 'text'}
                        placeholder="Value"
                        value={item.value}
                        onChange={(e) => handleCustomSettingChange(item.id, 'value', e.target.value)}
                        data-automation-id={`custom-setting-value-${item.id}`}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => handleCustomSettingToggleSensitive(item.id)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        title={item.isSensitive ? "Mark as public" : "Mark as sensitive"}
                      >
                        {item.isSensitive ? <Lock className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button
                      id={`remove-custom-setting-${item.id}`}
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveCustomSetting(item.id)}
                      className="text-gray-500 hover:text-red-600"
                      data-automation-id={`remove-custom-setting-${item.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="pt-2">
                  <Button
                    id="add-custom-setting-button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddCustomSetting}
                    data-automation-id="add-custom-setting"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Entry
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Schedules</CardTitle>
            <CardDescription>
              Configure scheduled tasks for this extension by invoking a manifest-declared API endpoint on a cron schedule.
              On extension updates, schedules are remapped by endpoint method/path; updates may be blocked if a scheduled endpoint is removed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {schedulesError ? (
              <div className="text-sm text-red-600">{schedulesError}</div>
            ) : schedulesLoading ? (
              <div className="text-sm text-gray-500">Loading schedules…</div>
            ) : (
              <div className="space-y-6">
                {apiEndpoints.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    This extension does not declare any API endpoints, so there is nothing to schedule.
                  </div>
                ) : (
                  <div className="grid gap-3 max-w-2xl">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                      <div className="md:col-span-2">
                        <label className="text-sm font-medium">Endpoint</label>
                        <CustomSelect
                          options={apiEndpoints.map((e) => ({
                            value: e.id,
                            label: `${e.method} ${e.path}`,
                          }))}
                          value={newScheduleEndpointId}
                          onValueChange={(val) => setNewScheduleEndpointId(val)}
                          placeholder="Select an endpoint"
                          {...automationId('extension-schedule-endpoint')}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Cron</label>
                        <Input
                          value={newScheduleCron}
                          onChange={(e) => setNewScheduleCron(e.target.value)}
                          placeholder="0 0 * * *"
                          {...automationId('extension-schedule-cron')}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Timezone</label>
                        <Input
                          value={newScheduleTimezone}
                          onChange={(e) => {
                            didTouchScheduleTimezoneRef.current = true;
                            setNewScheduleTimezone(e.target.value);
                          }}
                          placeholder="UTC"
                          {...automationId('extension-schedule-timezone')}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2 max-w-2xl">
                      <label className="text-sm font-medium">Payload (JSON, optional)</label>
                      <TextArea
                        value={newSchedulePayload}
                        onChange={(e) => setNewSchedulePayload(e.target.value)}
                        placeholder='{"example":"value"}'
                        {...automationId('extension-schedule-payload')}
                      />
                      <div className="text-xs text-gray-500">
                        For GET endpoints, payload is ignored. For POST endpoints, payload becomes the request body.
                        Avoid including secrets in payloads; use the extension's config/secrets instead.
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        id="create-schedule-button"
                        variant="outline"
                        disabled={!newScheduleEndpointId || schedulesLoading}
                        onClick={async () => {
                          let payloadJson: any = undefined;
                          const trimmed = newSchedulePayload.trim();
                          if (trimmed.length > 0) {
                            try {
                              payloadJson = JSON.parse(trimmed);
                            } catch {
                              toast.error('Payload must be valid JSON.');
                              return;
                            }
                          }
                          const result = await createExtensionSchedule(extensionId, {
                            endpointId: newScheduleEndpointId,
                            cron: newScheduleCron,
                            timezone: newScheduleTimezone,
                            enabled: true,
                            payloadJson,
                          });
                          if (!result.success) {
                            toast.error(result.message || 'Failed to create schedule.');
                            return;
                          }
                          toast.success('Schedule created.');
                          setNewSchedulePayload('');
                          await refreshSchedules();
                        }}
                      >
                        Create schedule
                      </Button>
                      <Button
                        id="refresh-schedules-button"
                        variant="ghost"
                        disabled={schedulesLoading}
                        onClick={refreshSchedules}
                      >
                        Refresh
                      </Button>
                    </div>
                  </div>
                )}

                {schedules.length === 0 ? (
                  <div className="text-sm text-gray-500">No schedules configured.</div>
                ) : (
                  <div className="space-y-3">
                    {schedules.map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between gap-4 border rounded-md p-3">
                        <div className="min-w-0">
                          {editingScheduleId === s.id ? (
                            <div className="grid gap-2 max-w-xl">
                              <CustomSelect
                                options={apiEndpoints.map((e) => ({
                                  value: e.id,
                                  label: `${e.method} ${e.path}`,
                                }))}
                                value={editEndpointId}
                                onValueChange={(val) => setEditEndpointId(val)}
                                placeholder="Select an endpoint"
                              />
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <Input value={editCron} onChange={(e) => setEditCron(e.target.value)} placeholder="0 0 * * *" />
                                <Input value={editTimezone} onChange={(e) => setEditTimezone(e.target.value)} placeholder="UTC" />
                              </div>
                              <TextArea
                                value={editPayload}
                                onChange={(e) => setEditPayload(e.target.value)}
                                placeholder='{"example":"value"}'
                              />
                              <div className="flex gap-2">
                                <Button
                                  id={`save-schedule-${s.id}`}
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    let payloadJson: any = null;
                                    const trimmed = editPayload.trim();
                                    if (trimmed.length > 0) {
                                      try {
                                        payloadJson = JSON.parse(trimmed);
                                      } catch {
                                        toast.error('Payload must be valid JSON.');
                                        return;
                                      }
                                    } else {
                                      payloadJson = null;
                                    }
                                    const out = await updateExtensionSchedule(extensionId, s.id, {
                                      endpointId: editEndpointId,
                                      cron: editCron,
                                      timezone: editTimezone,
                                      payloadJson,
                                    });
                                    if (!out.success) {
                                      toast.error(out.message || 'Failed to update schedule.');
                                      return;
                                    }
                                    toast.success('Schedule updated.');
                                    setEditingScheduleId(null);
                                    await refreshSchedules();
                                  }}
                                >
                                  Save
                                </Button>
                                <Button
                                  id={`cancel-edit-schedule-${s.id}`}
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingScheduleId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="text-sm font-medium truncate">
                                {s.endpoint_method} {s.endpoint_path}
                              </div>
                              <div className="text-xs text-gray-500 truncate">
                                {s.cron} ({s.timezone}){s.last_run_status ? ` • last: ${s.last_run_status}` : ''}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Switch
                            checked={Boolean(s.enabled)}
                            onCheckedChange={async (checked) => {
                              const out = await updateExtensionSchedule(extensionId, s.id, { enabled: checked });
                              if (!out.success) {
                                toast.error(out.message || 'Failed to update schedule.');
                                return;
                              }
                              await refreshSchedules();
                            }}
                          />
                          <Button
                            id={`edit-schedule-${s.id}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingScheduleId(s.id);
                              setEditCron(String(s.cron || ''));
                              setEditTimezone(String(s.timezone || 'UTC'));
                              setEditEndpointId(String(s.endpoint_id || ''));
                              setEditPayload(s.payload_json ? JSON.stringify(s.payload_json, null, 2) : '');
                            }}
                            disabled={editingScheduleId === s.id}
                          >
                            Edit
                          </Button>
                          <Button
                            id={`run-schedule-now-${s.id}`}
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              const out = await runExtensionScheduleNow(extensionId, s.id);
                              if (!out.success) {
                                toast.error(out.message || 'Failed to run schedule.');
                                return;
                              }
                              toast.success('Schedule run enqueued.');
                            }}
                          >
                            Run now
                          </Button>
                          <Button
                            id={`delete-schedule-${s.id}`}
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={async () => {
                              if (!confirm('Delete this schedule?')) return;
                              const out = await deleteExtensionSchedule(extensionId, s.id);
                              if (!out.success) {
                                toast.error(out.message || 'Failed to delete schedule.');
                                return;
                              }
                              toast.success('Schedule deleted.');
                              await refreshSchedules();
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
    </ReflectionContainer >
  );
}
