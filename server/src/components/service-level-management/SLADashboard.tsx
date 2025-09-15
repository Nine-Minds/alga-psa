'use client';

import React, { useState, useEffect } from 'react';
import { IServiceLevelAgreement, IServiceMetrics } from '../../interfaces/service.interfaces';

interface SLAStats {
  total_slas: number;
  active_slas: number;
  breached_slas: number;
  avg_compliance: number;
  sla_performance: {
    [sla_id: string]: {
      name: string;
      compliance_percentage: number;
      recent_breaches: number;
      status: string;
    };
  };
}

export function SLADashboard() {
  const [slas, setSLAs] = useState<IServiceLevelAgreement[]>([]);
  const [stats, setStats] = useState<SLAStats | null>(null);
  const [metrics, setMetrics] = useState<IServiceMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTimeRange, setSelectedTimeRange] = useState('30d');
  const [selectedSLA, setSelectedSLA] = useState<string>('');

  useEffect(() => {
    fetchSLAs();
    fetchStats();
    fetchMetrics();
  }, [selectedTimeRange, selectedSLA]);

  const fetchSLAs = async () => {
    try {
      const response = await fetch('/api/slas');
      const data = await response.json();
      setSLAs(data);
    } catch (error) {
      console.error('Error fetching SLAs:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const params = new URLSearchParams();
      params.append('timeRange', selectedTimeRange);
      if (selectedSLA) params.append('slaId', selectedSLA);

      const response = await fetch(`/api/slas/stats?${params.toString()}`);
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching SLA stats:', error);
    }
  };

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('timeRange', selectedTimeRange);
      if (selectedSLA) params.append('slaId', selectedSLA);

      const response = await fetch(`/api/service-metrics?${params.toString()}`);
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getComplianceColor = (percentage: number) => {
    if (percentage >= 99) return 'text-green-600 bg-green-100';
    if (percentage >= 95) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'breached': return 'bg-red-100 text-red-800';
      case 'at_risk': return 'bg-yellow-100 text-yellow-800';
      case 'suspended': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatMetricValue = (metric: IServiceMetrics) => {
    switch (metric.metric_type) {
      case 'response_time':
      case 'resolution_time':
        return `${metric.average_value}ms`;
      case 'availability':
      case 'customer_satisfaction':
        return `${(metric.average_value * 100).toFixed(2)}%`;
      case 'incident_count':
      case 'change_success_rate':
        return metric.average_value.toString();
      default:
        return metric.average_value.toString();
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Level Management</h1>
          <p className="text-gray-600">Monitor and manage service level agreements and performance metrics</p>
        </div>
        <div className="flex space-x-3">
          <select
            value={selectedTimeRange}
            onChange={(e) => setSelectedTimeRange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last year</option>
          </select>
          <select
            value={selectedSLA}
            onChange={(e) => setSelectedSLA(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All SLAs</option>
            {Array.isArray(slas) && slas.map((sla: IServiceLevelAgreement) => (
              <option key={sla.sla_id} value={sla.sla_id}>
                {sla.sla_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">S</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total SLAs</p>
                <p className="text-2xl font-bold text-gray-900">{stats.total_slas}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">A</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Active SLAs</p>
                <p className="text-2xl font-bold text-gray-900">{stats.active_slas}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">B</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Breached SLAs</p>
                <p className="text-2xl font-bold text-gray-900">{stats.breached_slas}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  stats.avg_compliance >= 99 ? 'bg-green-500' :
                  stats.avg_compliance >= 95 ? 'bg-yellow-500' : 'bg-red-500'
                }`}>
                  <span className="text-white text-sm font-medium">%</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Avg Compliance</p>
                <p className="text-2xl font-bold text-gray-900">{stats.avg_compliance.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SLA Performance Grid */}
      {stats && Object.keys(stats.sla_performance).length > 0 && (
        <div className="bg-white rounded-lg shadow border mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">SLA Performance Overview</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
            {stats && Object.entries(stats.sla_performance).map(([slaId, performance]) => (
              <div key={slaId} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-3">
                  <h4 className="font-medium text-gray-900 truncate">{performance.name}</h4>
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(performance.status)}`}>
                    {performance.status.replace('_', ' ')}
                  </span>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Compliance</span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded ${getComplianceColor(performance.compliance_percentage)}`}>
                      {performance.compliance_percentage.toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Recent Breaches</span>
                    <span className="text-sm font-medium text-gray-900">{performance.recent_breaches}</span>
                  </div>
                  
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        performance.compliance_percentage >= 99 ? 'bg-green-500' :
                        performance.compliance_percentage >= 95 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${performance.compliance_percentage}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Service Metrics Table */}
      <div className="bg-white rounded-lg shadow border">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Service Metrics</h3>
        </div>

        {loading ? (
          <div className="p-6 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading metrics...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Service
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Metric Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Current Value
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Target
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Trend
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Updated
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Array.isArray(metrics) && metrics.map((metric) => {
                  const isOnTarget = metric.average_value >= (metric.target_value || 0);
                  const trend = metric.trend || 'stable';
                  
                  return (
                    <tr key={`${metric.service_id}-${metric.metric_type}`} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {metric.service_name || 'Unknown Service'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {metric.metric_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {formatMetricValue(metric)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {metric.target_value ? formatMetricValue({...metric, average_value: metric.target_value}) : 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${
                          trend === 'improving' ? 'bg-green-100 text-green-800' :
                          trend === 'declining' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {trend === 'improving' ? '↗' : trend === 'declining' ? '↘' : '→'}
                          {trend}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          isOnTarget ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {isOnTarget ? 'On Target' : 'Below Target'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(metric.recorded_date).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {Array.isArray(metrics) && metrics.length === 0 && !loading && (
              <div className="p-6 text-center">
                <p className="text-gray-500">No metrics found for the selected criteria.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="mt-6 flex flex-wrap gap-4">
        <button 
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onClick={() => {/* Navigate to create SLA */}}
        >
          Create New SLA
        </button>
        <button 
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
          onClick={() => {/* Navigate to service catalog */}}
        >
          Manage Services
        </button>
        <button 
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
          onClick={() => {/* Navigate to reports */}}
        >
          Generate SLA Report
        </button>
        <button 
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
          onClick={() => {/* Navigate to customer satisfaction */}}
        >
          Customer Satisfaction
        </button>
      </div>
    </div>
  );
}