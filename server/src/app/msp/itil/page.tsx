'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  AlertTriangle, 
  RefreshCw, 
  BarChart3, 
  Database, 
  Package,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  Target
} from 'lucide-react';

interface ITILMetrics {
  incidents: {
    total: number;
    by_priority: { [key: string]: number };
    avg_resolution_time: number;
  };
  problems: {
    total: number;
    by_status: { [key: string]: number };
    avg_analysis_time: number;
  };
  changes: {
    total: number;
    success_rate: number;
    pending_approval: number;
  };
  services: {
    total_slas: number;
    avg_compliance: number;
    breached_slas: number;
  };
  cmdb: {
    total_cis: number;
    data_quality_score: number;
    relationships: number;
  };
}

export default function ITILOverviewPage() {
  const [metrics, setMetrics] = useState<ITILMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('30d');

  useEffect(() => {
    fetchMetrics();
  }, [timeRange]);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/itil/metrics?timeRange=${timeRange}`);
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching ITIL metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const itilProcesses = [
    {
      name: 'Problem Management',
      icon: AlertTriangle,
      href: '/msp/itil/problems',
      description: 'Track and resolve recurring issues',
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      value: metrics?.problems.total || 0,
      trend: '+12%'
    },
    {
      name: 'Change Management',
      icon: RefreshCw,
      href: '/msp/itil/changes',
      description: 'Manage change requests and approvals',
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
      value: metrics?.changes.total || 0,
      trend: '+8%'
    },
    {
      name: 'Service Level Management',
      icon: BarChart3,
      href: '/msp/itil/service-levels',
      description: 'Monitor SLAs and service performance',
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      value: metrics?.services.avg_compliance ? `${metrics.services.avg_compliance.toFixed(1)}%` : '0%',
      trend: '+2%'
    },
    {
      name: 'Configuration Management',
      icon: Database,
      href: '/msp/itil/cmdb',
      description: 'Manage configuration items and dependencies',
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
      value: metrics?.cmdb.total_cis || 0,
      trend: '+15%'
    },
    {
      name: 'Service Catalog',
      icon: Package,
      href: '/msp/itil/service-catalog',
      description: 'Browse and manage service offerings',
      color: 'text-orange-600',
      bgColor: 'bg-orange-100',
      value: metrics?.services.total_slas || 0,
      trend: '+5%'
    }
  ];

  const kpis = [
    {
      name: 'Incident Resolution Time',
      value: metrics ? `${metrics.incidents.avg_resolution_time}h` : '0h',
      change: '-15%',
      trend: 'down',
      icon: Clock
    },
    {
      name: 'Change Success Rate',
      value: metrics ? `${metrics.changes.success_rate}%` : '0%',
      change: '+3%',
      trend: 'up',
      icon: CheckCircle
    },
    {
      name: 'SLA Compliance',
      value: metrics ? `${metrics.services.avg_compliance.toFixed(1)}%` : '0%',
      change: '+1.2%',
      trend: 'up',
      icon: Target
    },
    {
      name: 'Data Quality Score',
      value: metrics ? `${metrics.cmdb.data_quality_score}%` : '0%',
      change: '+8%',
      trend: 'up',
      icon: Database
    }
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ITIL Management Overview</h1>
          <p className="text-gray-600">Monitor and manage ITIL processes across your organization</p>
        </div>
        <div className="flex items-center space-x-3">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.name} className="bg-white rounded-lg shadow border p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{kpi.name}</p>
                <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
                <div className="flex items-center mt-2">
                  {kpi.trend === 'up' ? (
                    <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                  ) : (
                    <TrendingUp className="w-4 h-4 text-red-500 mr-1 transform rotate-180" />
                  )}
                  <span className={`text-sm font-medium ${
                    kpi.trend === 'up' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {kpi.change}
                  </span>
                </div>
              </div>
              <div className={`flex-shrink-0 ${
                kpi.trend === 'up' ? 'text-green-500' : 'text-red-500'
              }`}>
                <kpi.icon className="w-8 h-8" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ITIL Processes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {itilProcesses.map((process) => (
          <Link 
            key={process.name}
            href={process.href}
            className="block bg-white rounded-lg shadow border hover:shadow-lg transition-shadow group"
          >
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className={`flex-shrink-0 p-3 rounded-lg ${process.bgColor}`}>
                  <process.icon className={`w-6 h-6 ${process.color}`} />
                </div>
                <div className="ml-4 flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600">
                    {process.name}
                  </h3>
                  <p className="text-sm text-gray-600">{process.description}</p>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{process.value}</p>
                  <p className="text-sm text-gray-600">Total Records</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-green-600">{process.trend}</p>
                  <p className="text-sm text-gray-600">vs last period</p>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Activity & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow border">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Recent ITIL Activity</h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <RefreshCw className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">Change Request CR-2024-001 approved</p>
                  <p className="text-sm text-gray-600">2 minutes ago</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">New problem record created: Database Performance</p>
                  <p className="text-sm text-gray-600">15 minutes ago</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">SLA compliance target met for Email Service</p>
                  <p className="text-sm text-gray-600">1 hour ago</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <Database className="w-5 h-5 text-purple-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">25 new CIs discovered via network scan</p>
                  <p className="text-sm text-gray-600">3 hours ago</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Alerts & Issues */}
        <div className="bg-white rounded-lg shadow border">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Alerts & Issues</h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-3 p-3 bg-red-50 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-900">SLA Breach Alert</p>
                  <p className="text-sm text-red-700">Email Service response time exceeded threshold</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 p-3 bg-yellow-50 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-yellow-900">Change Conflict</p>
                  <p className="text-sm text-yellow-700">Overlapping changes scheduled for Database Server</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 p-3 bg-blue-50 rounded-lg">
                <Database className="w-5 h-5 text-blue-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-900">CMDB Data Quality</p>
                  <p className="text-sm text-blue-700">15 CIs missing mandatory attributes</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 p-3 bg-green-50 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-900">All Systems Normal</p>
                  <p className="text-sm text-green-700">No critical issues detected</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}