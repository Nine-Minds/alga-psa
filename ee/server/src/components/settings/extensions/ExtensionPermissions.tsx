/**
 * Extension Permissions Component
 * 
 * Displays extension permissions in a structured way
 */
'use client';

import React from 'react';
import { ShieldIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, InfoIcon } from 'lucide-react';

export interface ExtensionPermissionsProps {
  permissions: string[];
  compact?: boolean;
}

// Categorize permissions for display
const categorizePermissions = (permissions: string[]) => {
  const categories: Record<string, string[]> = {
    'Storage': [],
    'UI': [],
    'Data': [],
    'API': [],
    'System': [],
    'Other': []
  };
  
  permissions.forEach(permission => {
    const [resource, action] = permission.split(':');
    
    switch (resource) {
      case 'storage':
        categories['Storage'].push(permission);
        break;
      case 'ui':
        categories['UI'].push(permission);
        break;
      case 'data':
      case 'company':
      case 'contact':
      case 'invoice':
      case 'ticket':
        categories['Data'].push(permission);
        break;
      case 'api':
        categories['API'].push(permission);
        break;
      case 'system':
      case 'integration':
        categories['System'].push(permission);
        break;
      default:
        categories['Other'].push(permission);
        break;
    }
  });
  
  // Filter out empty categories
  return Object.entries(categories).filter(([_, perms]) => perms.length > 0);
};

// Get severity level of a permission
const getPermissionSeverity = (permission: string): 'low' | 'medium' | 'high' => {
  const [resource, action] = permission.split(':');
  
  // Read-only permissions are generally low severity
  if (action === 'read' || action === 'view' || action === 'list') {
    return 'low';
  }
  
  // Write/update permissions are medium severity
  if (action === 'write' || action === 'update') {
    return 'medium';
  }
  
  // Delete/create permissions are high severity
  if (action === 'delete' || action === 'create' || action === 'execute' || action === 'manage') {
    return 'high';
  }
  
  // API permissions are medium to high severity
  if (resource === 'api') {
    return action === 'read' ? 'medium' : 'high';
  }
  
  // Invoice and billing permissions are higher severity
  if (resource === 'invoice' || resource === 'billing') {
    return action === 'read' ? 'low' : 'high';
  }
  
  // Integration permissions are higher severity
  if (resource === 'integration' || resource === 'system') {
    return 'high';
  }
  
  // Default to medium
  return 'medium';
};

// Get color for severity level
const getSeverityColor = (severity: 'low' | 'medium' | 'high') => {
  switch (severity) {
    case 'low':
      return 'bg-green-100 text-green-800';
    case 'medium':
      return 'bg-amber-100 text-amber-800';
    case 'high':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

// Get icon for severity level
const getSeverityIcon = (severity: 'low' | 'medium' | 'high') => {
  switch (severity) {
    case 'low':
      return <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />;
    case 'medium':
      return <AlertTriangleIcon className="h-3.5 w-3.5 mr-1" />;
    case 'high':
      return <XCircleIcon className="h-3.5 w-3.5 mr-1" />;
    default:
      return <InfoIcon className="h-3.5 w-3.5 mr-1" />;
  }
};

/**
 * Component to display extension permissions in a structured way
 */
export function ExtensionPermissions({ permissions, compact = false }: ExtensionPermissionsProps) {
  // If there are no permissions, render nothing
  if (!permissions || permissions.length === 0) {
    return null;
  }
  
  // Categorize permissions
  const categorizedPermissions = categorizePermissions(permissions);
  
  // If compact mode, just show pills
  if (compact) {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {permissions.map((permission) => {
          const severity = getPermissionSeverity(permission);
          return (
            <li
              key={permission}
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getSeverityColor(severity)}`}
              title={permission}
            >
              {getSeverityIcon(severity)}
              {permission}
            </li>
          );
        })}
      </ul>
    );
  }
  
  // Full display mode
  return (
    <div className="space-y-4">
      {categorizedPermissions.map(([category, categoryPermissions]) => (
        <div key={category}>
          <h4 className="text-sm font-medium text-gray-700 mb-2">{category} Permissions</h4>
          <ul className="space-y-2">
            {categoryPermissions.map((permission) => {
              const severity = getPermissionSeverity(permission);
              return (
                <li key={permission} className="flex items-start">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getSeverityColor(severity)}`}>
                    {getSeverityIcon(severity)}
                    {permission}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    {severity === 'low' && 'Read-only access'}
                    {severity === 'medium' && 'Modification access'}
                    {severity === 'high' && 'Advanced access'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      
      <div className="text-xs text-gray-500 mt-2">
        <p>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium bg-green-100 text-green-800 mr-1">
            <CheckCircleIcon className="h-3 w-3 mr-0.5" /> Low
          </span>{' '}
          Read-only permissions allow the extension to view data but not modify it.
        </p>
        <p className="mt-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium bg-amber-100 text-amber-800 mr-1">
            <AlertTriangleIcon className="h-3 w-3 mr-0.5" /> Medium
          </span>{' '}
          Modification permissions allow the extension to update existing data.
        </p>
        <p className="mt-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-800 mr-1">
            <XCircleIcon className="h-3 w-3 mr-0.5" /> High
          </span>{' '}
          Advanced permissions allow the extension to create, delete, or execute operations.
        </p>
      </div>
    </div>
  );
}