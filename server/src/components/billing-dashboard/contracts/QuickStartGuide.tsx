'use client';

import React, { useState } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import {
  FileText,
  DollarSign,
  Clock,
  Droplet,
  Activity,
  CheckCircle,
  PlayCircle,
  X,
  ChevronRight
} from 'lucide-react';

interface QuickStartGuideProps {
  onDismiss?: () => void;
  onCreateContract?: () => void;
}

export const QuickStartGuide: React.FC<QuickStartGuideProps> = ({
  onDismiss,
  onCreateContract
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isExpanded) {
    return (
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PlayCircle className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-gray-900">Quick Start Guide</span>
            <Badge variant="default" className="bg-blue-100 text-blue-800">
              New
            </Badge>
          </div>
          <Button
            id="quickstart-show-guide"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(true)}
            className="text-blue-600 hover:text-blue-700"
          >
            Show Guide
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <PlayCircle className="h-6 w-6 text-blue-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Quick Start Guide</h3>
            <p className="text-sm text-gray-600">Learn how to create and manage contracts</p>
          </div>
          <Badge variant="default" className="bg-blue-100 text-blue-800">
            New
          </Badge>
        </div>
        <div className="flex items-center gap-2">
            <Button
              id="quickstart-minimize"
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(false)}
              className="text-gray-500"
            >
              Minimize
            </Button>
          {onDismiss && (
            <Button
              id="quickstart-dismiss"
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="text-gray-500"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Step 1 */}
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-blue-700 font-semibold">1</span>
            </div>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-gray-900 mb-1">Create a Contract</h4>
            <p className="text-sm text-gray-600 mb-2">
              Click "New Contract" to start the wizard. Choose a client and name your contract.
            </p>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500">Required: Client, Contract Name, Start Date</span>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <span className="text-green-700 font-semibold">2</span>
            </div>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-gray-900 mb-1">Configure Billing</h4>
            <p className="text-sm text-gray-600 mb-2">
              Choose your billing model(s). You can combine multiple types:
            </p>
            <div className="space-y-2 ml-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-600" />
                <span className="text-sm text-gray-700"><strong>Fixed Fee:</strong> Same price every month</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-600" />
                <span className="text-sm text-gray-700"><strong>Hourly:</strong> Bill by time tracked</span>
              </div>
              <div className="flex items-center gap-2">
                <Droplet className="h-4 w-4 text-blue-600" />
                <span className="text-sm text-gray-700"><strong>Bucket Hours:</strong> Prepaid hours + overage</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-orange-600" />
                <span className="text-sm text-gray-700"><strong>Usage-Based:</strong> Bill by consumption/usage</span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <span className="text-purple-700 font-semibold">3</span>
            </div>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-gray-900 mb-1">Review & Create</h4>
            <p className="text-sm text-gray-600 mb-2">
              Double-check everything before creating. You can always edit later.
            </p>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500">Tip: At least one service line is required</span>
            </div>
          </div>
        </div>

        {/* Best Practices */}
        <div className="mt-6 pt-4 border-t border-blue-200">
          <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-blue-600" />
            Best Practices
          </h4>
          <ul className="space-y-1 ml-6 text-sm text-gray-600">
            <li className="list-disc">Use clear, descriptive contract names (e.g., "Acme Corp - MSP Services Q4 2024")</li>
            <li className="list-disc">Enable proration for contracts that start/end mid-month</li>
            <li className="list-disc">Set end dates for fixed-term contracts to track renewal dates</li>
            <li className="list-disc">Add PO numbers when required by client procurement policies</li>
          </ul>
        </div>

        {/* Action Button */}
        {onCreateContract && (
          <div className="mt-6 pt-4 border-t border-blue-200">
            <Button
              id="quickstart-create-contract"
              onClick={onCreateContract}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              <FileText className="h-4 w-4 mr-2" />
              Create Your First Contract
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};
