'use client';
import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
export default function FolderBreadcrumb({ folderPath, onNavigate }) {
    if (!folderPath) {
        return (<div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <Home className="w-4 h-4"/>
        <span>All Documents</span>
      </div>);
    }
    const parts = folderPath.split('/').filter(p => p.length > 0);
    const breadcrumbs = parts.map((part, index) => ({
        name: part,
        path: '/' + parts.slice(0, index + 1).join('/')
    }));
    return (<div className="flex items-center gap-2 text-sm">
      <button id="breadcrumb-home" onClick={() => onNavigate(null)} className="flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
        <Home className="w-4 h-4"/>
      </button>

      {breadcrumbs.map((crumb, index) => (<React.Fragment key={crumb.path}>
          <ChevronRight className="w-4 h-4 text-gray-400"/>
          <button id={`breadcrumb-${crumb.path.replace(/\//g, '-')}`} onClick={() => onNavigate(crumb.path)} className={`
              hover:text-gray-900 dark:hover:text-gray-100
              ${index === breadcrumbs.length - 1
                ? 'text-gray-900 dark:text-gray-100 font-medium'
                : 'text-gray-600 dark:text-gray-400'}
            `}>
            {crumb.name}
          </button>
        </React.Fragment>))}
    </div>);
}
//# sourceMappingURL=FolderBreadcrumb.jsx.map