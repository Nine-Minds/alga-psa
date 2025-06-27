/**
 * Wrapper component for EmailProviderConfiguration that handles tenant context
 */

'use client';

import React, { useState, useEffect } from 'react';
import { EmailProviderConfiguration } from './EmailProviderConfiguration';
import { getCurrentTenant } from '../lib/actions/tenantActions';
import { Alert, AlertDescription } from './ui/Alert';

export function EmailProviderConfigurationWrapper() {
  const [tenant, setTenant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTenant = async () => {
      try {
        const currentTenant = await getCurrentTenant();
        if (!currentTenant) {
          throw new Error('No tenant found');
        }
        setTenant(currentTenant);
      } catch (err) {
        console.error('Failed to fetch tenant:', err);
        setError('Failed to load tenant information');
      } finally {
        setLoading(false);
      }
    };

    fetchTenant();
  }, []);

  if (loading) {
    return <div className="text-center py-4">Loading...</div>;
  }

  if (error || !tenant) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error || 'Unable to load email provider configuration'}
        </AlertDescription>
      </Alert>
    );
  }

  return <EmailProviderConfiguration tenant={tenant} />;
}