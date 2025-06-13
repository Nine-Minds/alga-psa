import React, { useEffect, useState } from 'react';
import { NextPage } from 'next';

interface DebugInfo {
  navigationResponse?: any;
  error?: string;
  isEnterpriseMode?: boolean;
  extensions?: any[];
  apiEndpointExists?: boolean;
  fetchDetails?: {
    url: string;
    method: string;
    headers: any;
    status?: number;
    statusText?: string;
  };
}

const DebugExtensionsPage: NextPage = () => {
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDebugInfo = async () => {
      const info: DebugInfo = {};
      
      try {
        // Check if we're in enterprise mode
        info.isEnterpriseMode = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
        
        // Test the navigation endpoint
        const url = '/api/extensions/navigation-debug';
        info.fetchDetails = {
          url,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        };
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
        
        info.fetchDetails.status = response.status;
        info.fetchDetails.statusText = response.statusText;
        info.apiEndpointExists = response.status !== 404;
        
        if (response.ok) {
          const data = await response.json();
          info.navigationResponse = data;
          
          // Extract extensions if present
          if (data.extensions) {
            info.extensions = data.extensions;
          } else if (Array.isArray(data)) {
            info.extensions = data;
          }
        } else {
          const errorText = await response.text();
          info.error = `API Error: ${response.status} ${response.statusText}\n${errorText}`;
        }
      } catch (error) {
        info.error = `Fetch Error: ${error instanceof Error ? error.message : String(error)}`;
      }
      
      setDebugInfo(info);
      setLoading(false);
    };
    
    fetchDebugInfo();
  }, []);

  const formatJson = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Extension System Debug</h1>
        
        {loading ? (
          <div className="bg-white rounded-lg shadow p-6">
            <p>Loading debug information...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* System Info */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">System Information</h2>
              <div className="space-y-2">
                <div>
                  <span className="font-medium">Enterprise Mode:</span>{' '}
                  <span className={debugInfo.isEnterpriseMode ? 'text-green-600' : 'text-red-600'}>
                    {debugInfo.isEnterpriseMode ? 'YES' : 'NO'}
                  </span>
                </div>
                <div>
                  <span className="font-medium">API Endpoint Exists:</span>{' '}
                  <span className={debugInfo.apiEndpointExists ? 'text-green-600' : 'text-red-600'}>
                    {debugInfo.apiEndpointExists ? 'YES' : 'NO'}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Environment:</span>{' '}
                  {process.env.NODE_ENV}
                </div>
              </div>
            </div>

            {/* Fetch Details */}
            {debugInfo.fetchDetails && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4">API Request Details</h2>
                <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm">
                  {formatJson(debugInfo.fetchDetails)}
                </pre>
              </div>
            )}

            {/* Error Display */}
            {debugInfo.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-red-700">Error</h2>
                <pre className="text-red-600 whitespace-pre-wrap">{debugInfo.error}</pre>
              </div>
            )}

            {/* Extensions Found */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">
                Extensions Found ({debugInfo.extensions?.length || 0})
              </h2>
              {debugInfo.extensions && debugInfo.extensions.length > 0 ? (
                <div className="space-y-4">
                  {debugInfo.extensions.map((ext, index) => (
                    <div key={index} className="border rounded p-4">
                      <h3 className="font-medium mb-2">Extension {index + 1}</h3>
                      <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-sm">
                        {formatJson(ext)}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No extensions found</p>
              )}
            </div>

            {/* Raw Response */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Raw API Response</h2>
              {debugInfo.navigationResponse ? (
                <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm">
                  {formatJson(debugInfo.navigationResponse)}
                </pre>
              ) : (
                <p className="text-gray-500">No response data</p>
              )}
            </div>

            {/* Additional Debug Info */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Additional Debug Info</h2>
              <div className="space-y-2">
                <div>
                  <span className="font-medium">Current URL:</span>{' '}
                  {typeof window !== 'undefined' ? window.location.href : 'N/A'}
                </div>
                <div>
                  <span className="font-medium">Browser:</span>{' '}
                  {typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}
                </div>
                <div>
                  <span className="font-medium">Timestamp:</span>{' '}
                  {new Date().toISOString()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DebugExtensionsPage;