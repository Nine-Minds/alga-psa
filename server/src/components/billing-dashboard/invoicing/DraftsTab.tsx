'use client'

import React from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface DraftsTabProps {
  onRefreshNeeded?: () => void;
  refreshTrigger?: number;
}

const DraftsTab: React.FC<DraftsTabProps> = () => {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <Card>
        <div className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Draft Invoices</h3>
          <p className="text-gray-600 mb-4">Draft invoice management is coming soon to this view.</p>
          <Button id="drafts-view-generate" onClick={() => router.push('/msp/billing?tab=invoicing&subtab=generate')}>
            Generate Invoices
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default DraftsTab;
