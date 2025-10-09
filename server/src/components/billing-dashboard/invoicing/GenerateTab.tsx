'use client'

import React from 'react';
import { Card } from '../../ui/Card';
import { IService } from '../../../interfaces';

interface GenerateTabProps {
  initialServices: IService[];
  onGenerateSuccess: () => void;
  refreshTrigger: number;
}

const GenerateTab: React.FC<GenerateTabProps> = ({
  initialServices,
  onGenerateSuccess,
  refreshTrigger
}) => {
  return (
    <div className="space-y-4">
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Generate Invoices</h3>
          <div className="text-center py-12 text-gray-500">
            <p className="mb-4">Generate tab content coming soon...</p>
            <p className="text-sm">This will contain automatic invoice generation, manual invoices, and prepayment options.</p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default GenerateTab;
