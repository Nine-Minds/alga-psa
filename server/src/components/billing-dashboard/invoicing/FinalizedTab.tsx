'use client'

import React from 'react';
import { Card } from '../../ui/Card';

interface FinalizedTabProps {
  onRefreshNeeded: () => void;
  refreshTrigger: number;
}

const FinalizedTab: React.FC<FinalizedTabProps> = ({
  onRefreshNeeded,
  refreshTrigger
}) => {
  return (
    <div className="space-y-4">
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Finalized Invoices</h3>
          <div className="text-center py-12 text-gray-500">
            <p className="mb-4">Finalized tab content coming soon...</p>
            <p className="text-sm">This will show all finalized invoices with download and email options.</p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default FinalizedTab;
