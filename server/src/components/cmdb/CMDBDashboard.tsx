'use client';

import React, { useState, useEffect } from 'react';
import { IConfigurationItem, ICMDBMetrics } from '../../interfaces/cmdb.interfaces';
import { CMDBVisualization } from './CMDBVisualization';

export function CMDBDashboard() {
  const [configItems, setConfigItems] = useState<IConfigurationItem[]>([]);
  const [metrics, setMetrics] = useState<ICMDBMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedView, setSelectedView] = useState<'overview' | 'visualization' | 'discovery' | 'audit'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    ci_type: '',
    status: '',
    environment: '',
    criticality: ''
  });

  useEffect(() => {
    fetchConfigItems();
    fetchMetrics();
  }, [filters, searchQuery]);

  const fetchConfigItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.ci_type) params.append('type', filters.ci_type);
      if (filters.status) params.append('status', filters.status);
      if (filters.environment) params.append('environment', filters.environment);
      if (filters.criticality) params.append('criticality', filters.criticality);
      if (searchQuery) params.append('search', searchQuery);

      const response = await fetch(`/api/cmdb/configuration-items?${params.toString()}`);
      const data = await response.json();
      setConfigItems(data);
    } catch (error) {
      console.error('Error fetching configuration items:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/cmdb/metrics');
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching CMDB metrics:', error);
    }
  };

  const getCriticalityColor = (criticality: string) => {
    switch (criticality) {
      case 'very_high': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      case 'very_low': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live': return 'bg-green-100 text-green-800';
      case 'planned': return 'bg-blue-100 text-blue-800';
      case 'under_development': return 'bg-yellow-100 text-yellow-800';
      case 'withdrawn': return 'bg-red-100 text-red-800';
      case 'disposed': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Metrics Cards */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">CI</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total CIs</p>
                <p className="text-2xl font-bold text-gray-900">{metrics.inventory?.total_cis || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">R</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Relationships</p>
                <p className="text-2xl font-bold text-gray-900">{metrics.relationships?.total_relationships || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">Q</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Data Quality</p>
                <p className="text-2xl font-bold text-gray-900">{metrics.quality?.completeness_score || 0}%</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">O</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Orphaned CIs</p>
                <p className="text-2xl font-bold text-gray-900">{metrics.relationships?.orphaned_cis || 0}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CI Type Distribution */}
      {metrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow border">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Configuration Items by Type</h3>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {metrics && metrics.inventory && Object.entries(metrics.inventory.by_type).map(([type, count]) => (
                  <div key={type} className="flex justify-between items-center">
                    <span className="text-sm text-gray-700 capitalize">{type.replace('_', ' ')}</span>
                    <div className="flex items-center space-x-2">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${(count / (metrics.inventory?.total_cis || 1)) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium text-gray-900 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow border">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Configuration Items by Status</h3>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {metrics && metrics.inventory && Object.entries(metrics.inventory.by_status).map(([status, count]) => (
                  <div key={status} className="flex justify-between items-center">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(status)}`}>
                      {status.replace('_', ' ')}
                    </span>
                    <div className="flex items-center space-x-2">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-green-500 h-2 rounded-full"
                          style={{ width: `${(count / (metrics.inventory?.total_cis || 1)) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium text-gray-900 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent CI Changes */}
      <div className="bg-white rounded-lg shadow border">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Recent Configuration Items</h3>
            <button
              onClick={() => setSelectedView('visualization')}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              View All →
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Environment
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Owner
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Modified
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Array.isArray(configItems) && configItems.slice(0, 10).map((ci) => (
                <tr key={ci.ci_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{ci.ci_name}</div>
                        <div className="text-sm text-gray-500">{ci.ci_number}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">
                    {ci.ci_type.replace('_', ' ')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(ci.ci_status)}`}>
                      {ci.ci_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">
                    {ci.environment}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {ci.owner}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(ci.last_modified_date).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Configuration Management Database</h1>
          <p className="text-gray-600">Manage configuration items, relationships, and dependencies</p>
        </div>
        <div className="flex space-x-3">
          <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
            Run Discovery
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Add CI
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { key: 'overview', label: 'Overview', icon: '📊' },
            { key: 'visualization', label: 'Visualization', icon: '🔗' },
            { key: 'discovery', label: 'Discovery', icon: '🔍' },
            { key: 'audit', label: 'Audit & Compliance', icon: '📋' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSelectedView(tab.key as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                selectedView === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Filters (visible for overview and visualization) */}
      {(selectedView === 'overview' || selectedView === 'visualization') && (
        <div className="bg-white p-4 rounded-lg shadow border mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search CIs..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={filters.ci_type}
                onChange={(e) => setFilters({ ...filters, ci_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Types</option>
                <option value="server">Server</option>
                <option value="application">Application</option>
                <option value="database">Database</option>
                <option value="network">Network</option>
                <option value="service">Service</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Status</option>
                <option value="live">Live</option>
                <option value="planned">Planned</option>
                <option value="under_development">Under Development</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="disposed">Disposed</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
              <select
                value={filters.environment}
                onChange={(e) => setFilters({ ...filters, environment: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Environments</option>
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="testing">Testing</option>
                <option value="development">Development</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={fetchConfigItems}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Search
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content based on selected view */}
      <div>
        {selectedView === 'overview' && renderOverview()}
        {selectedView === 'visualization' && <CMDBVisualization configItems={configItems} />}
        {selectedView === 'discovery' && (
          <div className="bg-white rounded-lg shadow border p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Discovery Management</h3>
            <p className="text-gray-600">Discovery functionality will be implemented here.</p>
          </div>
        )}
        {selectedView === 'audit' && (
          <div className="bg-white rounded-lg shadow border p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Audit & Compliance</h3>
            <p className="text-gray-600">Audit and compliance reports will be shown here.</p>
          </div>
        )}
      </div>
    </div>
  );
}