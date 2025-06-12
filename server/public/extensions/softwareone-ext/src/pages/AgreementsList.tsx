import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExtensionContext, Agreement } from '../types';
import { useSwoneQuery } from '../hooks/useSwoneQuery';
import { SyncService } from '../services/syncService';

interface AgreementsListProps {
  context: ExtensionContext;
}

export const AgreementsList: React.FC<AgreementsListProps> = ({ context }) => {
  const navigate = useNavigate();
  const { storage, logger } = context;
  
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [filter, setFilter] = useState<Agreement['status'] | 'all'>('all');

  // Fetch agreements from cache
  const { data: agreements, isLoading, error, refetch } = useSwoneQuery<Agreement[]>(
    ['agreements', filter],
    async () => {
      const namespace = storage.getNamespace('swone');
      
      if (filter === 'all') {
        return await namespace.get('agreements') || [];
      } else {
        const byStatus = await namespace.get('agreements/byStatus') || {};
        return byStatus[filter] || [];
      }
    },
    {
      staleTime: 2 * 60 * 1000, // 2 minutes
    }
  );

  // Sync data
  const handleSync = async () => {
    try {
      const config = await storage.getNamespace('swone').get('config');
      if (!config) {
        throw new Error('Please configure API settings first');
      }

      const syncService = new SyncService(config, context);
      await syncService.performFullSync();
      
      // Refetch data after sync
      refetch();
    } catch (error) {
      logger.error('Sync failed', error);
    }
  };

  // Navigate to agreement detail
  const handleRowClick = (row: Agreement) => {
    navigate(`/softwareone/agreement/${row.id}`);
  };

  // Handle row selection
  const handleRowSelection = (id: string) => {
    setSelectedRows(prev => {
      if (prev.includes(id)) {
        return prev.filter(rowId => rowId !== id);
      }
      return [...prev, id];
    });
  };

  const handleSelectAll = () => {
    if (selectedRows.length === agreements?.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(agreements?.map(a => a.id) || []);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="p-4 rounded-md bg-red-50 text-red-800 border border-red-200">
          Failed to load agreements: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">SoftwareOne Agreements</h1>
        
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/settings/softwareone')}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
          >
            Settings
          </button>
          <button 
            onClick={handleSync}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Sync Now
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded-md text-sm ${
            filter === 'all' 
              ? 'bg-blue-600 text-white' 
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`px-3 py-1 rounded-md text-sm ${
            filter === 'active' 
              ? 'bg-blue-600 text-white' 
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          Active
        </button>
        <button
          onClick={() => setFilter('inactive')}
          className={`px-3 py-1 rounded-md text-sm ${
            filter === 'inactive' 
              ? 'bg-blue-600 text-white' 
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          Inactive
        </button>
        <button
          onClick={() => setFilter('pending')}
          className={`px-3 py-1 rounded-md text-sm ${
            filter === 'pending' 
              ? 'bg-blue-600 text-white' 
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          Pending
        </button>
        <button
          onClick={() => setFilter('expired')}
          className={`px-3 py-1 rounded-md text-sm ${
            filter === 'expired' 
              ? 'bg-blue-600 text-white' 
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          Expired
        </button>
      </div>

      {agreements && agreements.length === 0 ? (
        <div className="p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
          <p>No agreements found. Click "Sync Now" to fetch agreements from SoftwareOne.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedRows.length === agreements?.length && agreements?.length > 0}
                      onChange={handleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Agreement Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Consumer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Currency
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Visibility
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Margin %
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : (
                  agreements?.map((agreement) => (
                    <tr 
                      key={agreement.id} 
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleRowClick(agreement)}
                    >
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedRows.includes(agreement.id)}
                          onChange={() => handleRowSelection(agreement.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRowClick(agreement);
                          }}
                          className="text-blue-600 hover:underline"
                        >
                          {agreement.name}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {agreement.product}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {agreement.vendor}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {agreement.consumer}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                        {agreement.currency}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          agreement.status === 'active' ? 'bg-green-100 text-green-800' :
                          agreement.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                          agreement.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          agreement.status === 'expired' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {agreement.status.charAt(0).toUpperCase() + agreement.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span title={agreement.operations}>
                          {agreement.operations === 'visible' && '👁️'} 
                          {agreement.operations === 'hidden' && '🚫'} 
                          {agreement.operations === 'restricted' && '🔒'} 
                          {!['visible', 'hidden', 'restricted'].includes(agreement.operations) && '❓'} {agreement.operations}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {agreement.marginRpxy}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedRows.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-600">
            {selectedRows.length} agreement{selectedRows.length > 1 ? 's' : ''} selected
          </p>
        </div>
      )}
    </div>
  );
};