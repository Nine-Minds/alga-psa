'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { ReflectionContainer, automationId } from '@/lib/ui-reflection';
import { toast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchExtensionById, getExtensionSettings, updateExtensionSettings, resetExtensionSettings } from '@/lib/actions/extensionActions';
import { Extension, ExtensionSettingDefinition, ExtensionSettingType } from '@/lib/extensions/types';

export default function ExtensionSettings() {
  const params = useParams();
  const router = useRouter();
  const extensionId = params?.id as string;
  
  const [isLoading, setIsLoading] = useState(true);
  const [settingsData, setSettingsData] = useState<Record<string, any>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [extension, setExtension] = useState<Extension | null>(null);
  
  const settingsDefinitions = useMemo(() => {
    return extension?.manifest?.settings || [];
  }, [extension]);
  
  // Group settings by category
  const settingsByCategory = useMemo(() => {
    const grouped: Record<string, ExtensionSettingDefinition[]> = {
      'General': []
    };
    
    settingsDefinitions.forEach(setting => {
      const category = setting.category || 'General';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(setting);
    });
    
    return grouped;
  }, [settingsDefinitions]);
  
  // Categories for tabs
  const categories = useMemo(() => {
    return Object.keys(settingsByCategory);
  }, [settingsByCategory]);
  
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
        
        // Load settings
        const savedSettings = await getExtensionSettings(extensionId);
        
        // Initialize with defaults if no saved settings
        const initialSettings: Record<string, any> = {};
        extensionData.manifest.settings?.forEach(def => {
          initialSettings[def.key] = savedSettings?.[def.key] !== undefined 
            ? savedSettings[def.key] 
            : def.defaultValue !== undefined 
              ? def.defaultValue 
              : null;
        });
        
        setSettingsData(initialSettings);
        setHasChanges(false);
      } catch (error) {
        console.error('Failed to load extension settings', error);
        toast({
          title: 'Error',
          description: 'Failed to load extension settings.',
          variant: 'destructive',
        });
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
  
  // Save settings
  const handleSaveSettings = async () => {
    setIsLoading(true);
    
    try {
      const result = await updateExtensionSettings(extensionId, settingsData);
      
      if (!result.success) {
        toast({
          title: 'Error',
          description: result.message,
          variant: 'destructive',
        });
        return;
      }
      
      toast({
        title: 'Success',
        description: 'Extension settings saved successfully.',
      });
      
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save extension settings', error);
      toast({
        title: 'Error',
        description: 'Failed to save extension settings.',
        variant: 'destructive',
      });
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
        toast({
          title: 'Error',
          description: result.message,
          variant: 'destructive',
        });
        return;
      }
      
      // Reset local state to defaults
      const defaultSettings: Record<string, any> = {};
      settingsDefinitions.forEach(def => {
        defaultSettings[def.key] = def.defaultValue !== undefined ? def.defaultValue : null;
      });
      
      setSettingsData(defaultSettings);
      setHasChanges(false);
      
      toast({
        title: 'Success',
        description: 'Settings reset to default values.',
      });
    } catch (error) {
      console.error('Failed to reset extension settings', error);
      toast({
        title: 'Error',
        description: 'Failed to reset extension settings.',
        variant: 'destructive',
      });
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
          <Textarea
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
          <Select
            value={value || ''}
            onValueChange={(value) => handleSettingChange(key, value)}
          >
            <SelectTrigger className="max-w-md" {...automationIdProps}>
              <SelectValue placeholder={placeholder || 'Select an option'} />
            </SelectTrigger>
            <SelectContent>
              {options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
        
      default:
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
    }
  };
  
  if (!extension) {
    return (
      <div className="p-6">
        <div className="text-center">
          <h2 className="text-xl font-medium">Extension not found</h2>
          <p className="text-gray-500 mt-2">The extension you're looking for doesn't exist or you don't have access to it.</p>
          <Button
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
              variant="ghost"
              size="sm"
              className="mr-2"
              onClick={() => router.push(`/msp/settings/extensions/${extensionId}`)}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-semibold text-gray-900">
              {extension.name} Settings
            </h1>
          </div>
          
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={handleResetToDefaults}
              disabled={isLoading}
            >
              Reset to Defaults
            </Button>
            <Button 
              onClick={handleSaveSettings}
              disabled={isLoading || !hasChanges}
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
            {settingsDefinitions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">This extension doesn't have any configurable settings.</p>
              </div>
            ) : (
              <Tabs defaultValue={categories[0]}>
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
      </div>
    </ReflectionContainer>
  );
}