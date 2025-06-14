import { useState, useEffect } from 'react';

interface Extension {
  id: string;
  name: string;
  version: string;
  manifest: any;
  enabled: boolean;
}

/**
 * Hook to fetch and manage extensions
 */
export function useExtensions() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchExtensions() {
      try {
        const response = await fetch('/api/extensions');
        if (!response.ok) {
          throw new Error('Failed to fetch extensions');
        }
        const data = await response.json();
        setExtensions(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Failed to fetch extensions:', err);
        
        // For development, provide a mock extension using the actual database ID
        setExtensions([
          {
            id: '63a7a0dc-7836-4a5f-aa08-ecdb31b064b5', // Use actual database ID
            name: 'SoftwareOne Integration',
            version: '0.1.0',
            enabled: true,
            manifest: {
              id: 'com.alga.softwareone',
              name: 'SoftwareOne Integration',
              routes: [
                {
                  path: '/agreements',
                  component: 'descriptors/pages/AgreementsList.json'
                },
                {
                  path: '/agreements/:id',
                  component: 'descriptors/pages/AgreementDetail.json'
                },
                {
                  path: '/statements',
                  component: 'descriptors/pages/StatementsList.json'
                },
                {
                  path: '/statements/:id',
                  component: 'descriptors/pages/StatementDetail.json'
                },
                {
                  path: '/settings',
                  component: 'descriptors/pages/SettingsPage.json'
                }
              ]
            }
          }
        ]);
      } finally {
        setLoading(false);
      }
    }

    fetchExtensions();
  }, []);

  return {
    extensions,
    loading,
    error,
    refetch: () => {
      setLoading(true);
      setExtensions([]);
      setError(null);
    }
  };
}