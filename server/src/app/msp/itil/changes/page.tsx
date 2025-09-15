'use client';

import React, { useState } from 'react';
import { ChangeRequestForm } from '../../../../components/change-management/ChangeRequestForm';
import { CABApprovalPanel } from '../../../../components/change-management/CABApprovalPanel';
import { ChangeCalendar } from '../../../../components/change-management/ChangeCalendar';

export default function ChangesPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'create' | 'calendar' | 'approvals'>('overview');
  const [changes, setChanges] = useState([]);

  const handleCreateChange = async (data: any) => {
    try {
      const response = await fetch('/api/changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        setActiveTab('overview');
        // Refresh changes list
      }
    } catch (error) {
      console.error('Error creating change:', error);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'create':
        return (
          <ChangeRequestForm
            onSubmit={handleCreateChange}
            onCancel={() => setActiveTab('overview')}
          />
        );
      case 'calendar':
        return <ChangeCalendar tenant="" />;
      case 'approvals':
        return <CABApprovalPanel changeRequest={null} currentUserId="" userRole="" />;
      default:
        return (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Change Management</h1>
                <p className="text-gray-600">Manage change requests, approvals, and scheduling</p>
              </div>
              <button
                onClick={() => setActiveTab('create')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Create Change Request
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-medium text-gray-900 mb-2">Pending Changes</h3>
                <p className="text-3xl font-bold text-blue-600">12</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-medium text-gray-900 mb-2">This Week</h3>
                <p className="text-3xl font-bold text-green-600">5</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="text-lg font-medium text-gray-900 mb-2">Success Rate</h3>
                <p className="text-3xl font-bold text-yellow-600">94%</p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow border p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Changes</h3>
              <p className="text-gray-600">Change requests will be displayed here.</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 px-6">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'create', label: 'Create Change' },
            { key: 'calendar', label: 'Change Calendar' },
            { key: 'approvals', label: 'CAB Approvals' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {renderContent()}
    </div>
  );
}