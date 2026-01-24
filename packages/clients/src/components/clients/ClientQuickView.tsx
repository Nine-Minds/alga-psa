'use client';

import React, { useState, useEffect } from 'react';
import type { IClientWithLocation } from '@alga-psa/types';
import { getClientById } from '@alga-psa/clients/actions';
import ClientDetails from './ClientDetails';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';

interface ClientQuickViewProps {
  clientId: string;
  onClose?: () => void;
}

export const ClientQuickView: React.FC<ClientQuickViewProps> = ({ clientId, onClose }) => {
  const [client, setClient] = useState<IClientWithLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchClient = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getClientById(clientId);
        if (!data) {
          setError('Client not found');
        } else {
          setClient(data);
        }
      } catch (err) {
        console.error('Error fetching client for quick view:', err);
        setError('Failed to load client details');
      } finally {
        setLoading(false);
      }
    };

    fetchClient();
  }, [clientId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || 'Something went wrong'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <ClientDetails 
      client={client} 
      isInDrawer={true} 
      quickView={true} 
    />
  );
};

export default ClientQuickView;
