'use client';

import React, { useState, useEffect } from 'react';
import { IService } from '../../interfaces/service.interfaces';

export function ServiceCatalog() {
  const [services, setServices] = useState<IService[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    category: '',
    status: '',
    criticality: ''
  });
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    fetchServices();
  }, [filters, searchQuery]);

  const fetchServices = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.category) params.append('category', filters.category);
      if (filters.status) params.append('status', filters.status);
      if (filters.criticality) params.append('criticality', filters.criticality);
      if (searchQuery) params.append('search', searchQuery);

      const response = await fetch(`/api/services?${params.toString()}`);
      const data = await response.json();
      setServices(data);
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCriticalityColor = (criticality: string) => {
    switch (criticality) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-red-100 text-red-800';
      case 'planned': return 'bg-blue-100 text-blue-800';
      case 'deprecated': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Catalog</h1>
          <p className="text-gray-600">Manage and browse available services and their dependencies</p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Add New Service
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow border mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Services</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or description..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              <option value="infrastructure">Infrastructure</option>
              <option value="application">Application</option>
              <option value="platform">Platform</option>
              <option value="security">Security</option>
              <option value="communication">Communication</option>
              <option value="business">Business</option>
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
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="planned">Planned</option>
              <option value="deprecated">Deprecated</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Criticality</label>
            <select
              value={filters.criticality}
              onChange={(e) => setFilters({ ...filters, criticality: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Criticality</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
      </div>

      {/* Services Grid */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading services...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.isArray(services) && services.map((service) => (
            <div key={service.service_id} className="bg-white rounded-lg shadow border hover:shadow-lg transition-shadow">
              {/* Service Header */}
              <div className="p-6 border-b border-gray-200">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{service.service_name}</h3>
                  <div className="flex space-x-2">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(service.status)}`}>
                      {service.status}
                    </span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCriticalityColor(service.business_criticality)}`}>
                      {service.business_criticality}
                    </span>
                  </div>
                </div>
                
                <p className="text-sm text-gray-600 mb-3 line-clamp-3">{service.service_description}</p>
                
                <div className="text-xs text-gray-500">
                  <p><strong>Category:</strong> {service.service_category}</p>
                  <p><strong>Owner:</strong> {service.service_owner}</p>
                </div>
              </div>

              {/* Service Details */}
              <div className="p-4 space-y-3">
                {/* SLA Information */}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">SLA Targets:</span>
                  <div className="text-right">
                    {service.availability_target && (
                      <div>Uptime: {((service.availability_target || 0) * 100).toFixed(2)}%</div>
                    )}
                    {service.response_time_target && (
                      <div>Response: {service.response_time_target}ms</div>
                    )}
                  </div>
                </div>

                {/* Dependencies */}
                {service.dependencies && service.dependencies.length > 0 && (
                  <div>
                    <span className="text-sm text-gray-600">Dependencies:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {service.dependencies && service.dependencies.slice(0, 3).map((dep, index) => (
                        <span key={index} className="px-2 py-1 bg-gray-100 text-xs rounded">
                          {dep}
                        </span>
                      ))}
                      {service.dependencies.length > 3 && (
                        <span className="px-2 py-1 bg-gray-100 text-xs rounded">
                          +{service.dependencies.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Service Hours */}
                {service.service_hours && (
                  <div className="text-sm">
                    <span className="text-gray-600">Service Hours:</span>
                    <span className="ml-2 text-gray-900">{service.service_hours}</span>
                  </div>
                )}

                {/* Support Contact */}
                {service.support_contact && (
                  <div className="text-sm">
                    <span className="text-gray-600">Support:</span>
                    <span className="ml-2 text-gray-900">{service.support_contact}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="px-4 py-3 border-t border-gray-200 flex justify-between">
                <button className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                  View Details
                </button>
                <div className="space-x-2">
                  <button className="text-sm text-gray-600 hover:text-gray-800">
                    Edit
                  </button>
                  <button className="text-sm text-gray-600 hover:text-gray-800">
                    Manage SLA
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(services) && services.length === 0 && !loading && (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14-7H5m14 14H5" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No services found</h3>
          <p className="text-gray-600 mb-4">
            {searchQuery || Object.values(filters).some(f => f) 
              ? 'Try adjusting your search criteria.'
              : 'Get started by adding your first service to the catalog.'
            }
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Add Service
          </button>
        </div>
      )}

      {/* Service Statistics Footer */}
      <div className="mt-8 bg-white rounded-lg shadow border p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Service Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-blue-600">{Array.isArray(services) ? services.length : 0}</div>
            <div className="text-sm text-gray-600">Total Services</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {Array.isArray(services) ? services.filter(s => s.status === 'active').length : 0}
            </div>
            <div className="text-sm text-gray-600">Active Services</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-600">
              {Array.isArray(services) ? services.filter(s => s.business_criticality === 'critical').length : 0}
            </div>
            <div className="text-sm text-gray-600">Critical Services</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-purple-600">
              {Array.isArray(services) ? services.filter(s => s.dependencies && s.dependencies.length > 0).length : 0}
            </div>
            <div className="text-sm text-gray-600">With Dependencies</div>
          </div>
        </div>
      </div>
    </div>
  );
}