import React, { useState, useEffect } from 'react';
import { Formik, Form, Field } from 'formik';
import * as Yup from 'yup';
import * as Tabs from '@radix-ui/react-tabs';
import { SoftwareOneClient } from '../api/softwareOneClient';
import { SyncService } from '../services/syncService';
import { ExtensionContext, SoftwareOneConfig, SyncResult } from '../types';

const validationSchema = Yup.object({
  apiEndpoint: Yup.string()
    .url('Must be a valid URL')
    .required('API endpoint is required'),
  apiToken: Yup.string()
    .required('API token is required')
    .min(10, 'API token must be at least 10 characters'),
  syncInterval: Yup.number()
    .min(15, 'Minimum sync interval is 15 minutes')
    .max(1440, 'Maximum sync interval is 24 hours')
    .required('Sync interval is required'),
  enableAutoSync: Yup.boolean()
});

interface SettingsPageProps {
  context: ExtensionContext;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ context }) => {
  const { storage, logger } = context;
  
  const [config, setConfig] = useState<SoftwareOneConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [lastSync, setLastSync] = useState<any>(null);

  // Load configuration on mount
  useEffect(() => {
    loadConfiguration();
  }, []);

  const loadConfiguration = async () => {
    try {
      const storedConfig = await storage.getNamespace('swone').get('config');
      if (storedConfig) {
        setConfig(storedConfig);
      } else {
        // Set default config
        setConfig({
          apiEndpoint: 'https://api.softwareone.com',
          apiToken: '',
          syncInterval: 60,
          enableAutoSync: false
        });
      }

      // Load last sync info
      const syncInfo = await storage.getNamespace('swone').get('sync/lastSync');
      setLastSync(syncInfo);
    } catch (error) {
      logger.error('Failed to load configuration', error);
    } finally {
      setLoading(false);
    }
  };

  const saveConfiguration = async (values: SoftwareOneConfig) => {
    try {
      await storage.getNamespace('swone').set('config', values);
      setConfig(values);
      logger.info('Configuration saved successfully');
      return { success: true, message: 'Configuration saved successfully' };
    } catch (error) {
      logger.error('Failed to save configuration', error);
      throw new Error('Failed to save configuration');
    }
  };

  const testConnection = async () => {
    if (!config) return;

    setTestResult(null);
    try {
      const client = new SoftwareOneClient(config);
      const isConnected = await client.testConnection();
      
      setTestResult({
        success: isConnected,
        message: isConnected 
          ? 'Connection successful!' 
          : 'Connection failed. Please check your credentials.'
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  };

  const runManualSync = async () => {
    if (!config) return;

    setSyncResult(null);
    try {
      const syncService = new SyncService(config, context);
      const result = await syncService.performFullSync();
      setSyncResult(result);
      
      // Reload last sync info
      const syncInfo = await storage.getNamespace('swone').get('sync/lastSync');
      setLastSync(syncInfo);
    } catch (error) {
      setSyncResult({
        success: false,
        message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      });
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">SoftwareOne Integration Settings</h1>

      <Tabs.Root defaultValue="connection" className="w-full">
        <Tabs.List className="flex border-b mb-6">
          <Tabs.Trigger value="connection" className="px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Connection
          </Tabs.Trigger>
          <Tabs.Trigger value="sync" className="px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Synchronization
          </Tabs.Trigger>
          <Tabs.Trigger value="advanced" className="px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Advanced
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="connection">
          <Formik
            initialValues={config || {
              apiEndpoint: 'https://api.softwareone.com',
              apiToken: '',
              syncInterval: 60,
              enableAutoSync: false
            }}
            validationSchema={validationSchema}
            onSubmit={async (values, { setSubmitting }) => {
              try {
                await saveConfiguration(values);
                setTestResult({ success: true, message: 'Configuration saved successfully' });
              } catch (error) {
                setTestResult({ 
                  success: false, 
                  message: error instanceof Error ? error.message : 'Failed to save configuration' 
                });
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {({ errors, touched, isSubmitting }) => (
              <Form className="space-y-4">
                <div>
                  <label htmlFor="apiEndpoint" className="block text-sm font-medium mb-1">
                    API Endpoint
                  </label>
                  <Field
                    as="input"
                    id="apiEndpoint"
                    name="apiEndpoint"
                    type="url"
                    placeholder="https://api.softwareone.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {errors.apiEndpoint && touched.apiEndpoint && (
                    <div className="text-red-500 text-sm mt-1">{errors.apiEndpoint}</div>
                  )}
                </div>

                <div>
                  <label htmlFor="apiToken" className="block text-sm font-medium mb-1">
                    API Token
                  </label>
                  <Field
                    as="input"
                    id="apiToken"
                    name="apiToken"
                    type="password"
                    placeholder="Enter your API token"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {errors.apiToken && touched.apiToken && (
                    <div className="text-red-500 text-sm mt-1">{errors.apiToken}</div>
                  )}
                </div>

                <div className="flex gap-4">
                  <button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Saving...' : 'Save Configuration'}
                  </button>
                  <button 
                    type="button" 
                    onClick={testConnection}
                    disabled={!config?.apiToken || !config?.apiEndpoint}
                    className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    Test Connection
                  </button>
                </div>

                {testResult && (
                  <div className={`p-4 rounded-md ${testResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    {testResult.message}
                  </div>
                )}
              </Form>
            )}
          </Formik>
        </Tabs.Content>

        <Tabs.Content value="sync">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Synchronization Settings</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Sync Interval (minutes)
                  </label>
                  <input
                    type="number"
                    value={config?.syncInterval || 60}
                    onChange={(e) => setConfig(prev => prev ? {...prev, syncInterval: parseInt(e.target.value)} : null)}
                    min={15}
                    max={1440}
                    className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enableAutoSync"
                    checked={config?.enableAutoSync || false}
                    onChange={(e) => setConfig(prev => prev ? {...prev, enableAutoSync: e.target.checked} : null)}
                  />
                  <label htmlFor="enableAutoSync" className="text-sm">
                    Enable automatic synchronization
                  </label>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={runManualSync} 
                    disabled={!config?.apiToken}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    Run Manual Sync
                  </button>
                </div>

                {syncResult && (
                  <div className={`p-4 rounded-md ${syncResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    <div>
                      <strong>{syncResult.message}</strong>
                      {syncResult.counts && (
                        <div className="mt-2 text-sm">
                          <div>Agreements: {syncResult.counts.agreements}</div>
                          <div>Statements: {syncResult.counts.statements}</div>
                          <div>Subscriptions: {syncResult.counts.subscriptions}</div>
                          <div>Orders: {syncResult.counts.orders}</div>
                        </div>
                      )}
                      {syncResult.errors && syncResult.errors.length > 0 && (
                        <div className="mt-2 text-sm">
                          <strong>Errors:</strong>
                          <ul className="list-disc list-inside">
                            {syncResult.errors.map((error, idx) => (
                              <li key={idx}>{error}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {lastSync && (
                  <div className="mt-6 p-4 bg-gray-50 rounded">
                    <h4 className="font-medium mb-2">Last Sync Information</h4>
                    <div className="text-sm space-y-1">
                      <div>Timestamp: {new Date(lastSync.timestamp).toLocaleString()}</div>
                      {lastSync.counts && (
                        <>
                          <div>Agreements synced: {lastSync.counts.agreements}</div>
                          <div>Statements synced: {lastSync.counts.statements}</div>
                        </>
                      )}
                      {lastSync.errors && lastSync.errors.length > 0 && (
                        <div className="text-red-600">Errors: {lastSync.errors.length}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="advanced">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold mb-4">Advanced Settings</h3>
            
            <div className="p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
              <p className="text-sm">
                Advanced configuration options will be available in future versions.
                This may include:
              </p>
              <ul className="list-disc list-inside mt-2 text-sm">
                <li>Custom field mappings</li>
                <li>Webhook configuration</li>
                <li>API rate limiting settings</li>
                <li>Data retention policies</li>
              </ul>
            </div>

            <div className="mt-6">
              <h4 className="font-medium mb-2">Extension Information</h4>
              <div className="text-sm space-y-1">
                <div>Version: 0.1.0</div>
                <div>Tenant: {context.tenant.name}</div>
                <div>User: {context.user.email}</div>
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};