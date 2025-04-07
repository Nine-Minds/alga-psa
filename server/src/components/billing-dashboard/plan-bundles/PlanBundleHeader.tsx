'use client';

import React from 'react';
import { Badge } from 'server/src/components/ui/Badge';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';

interface PlanBundleHeaderProps {
  bundle: IPlanBundle;
}

const PlanBundleHeader: React.FC<PlanBundleHeaderProps> = ({ bundle }) => {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">{bundle.bundle_name}</h1>
        <Badge className={bundle.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
          {bundle.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>
      {bundle.bundle_description && (
        <p className="text-gray-600 mt-1">{bundle.bundle_description}</p>
      )}
      <div className="text-sm text-gray-500 mt-1">
        Bundle ID: {bundle.bundle_id}
      </div>
    </div>
  );
};

export default PlanBundleHeader;