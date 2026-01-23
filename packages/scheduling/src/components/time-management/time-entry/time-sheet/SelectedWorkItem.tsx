'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { IWorkItem } from '@alga-psa/types';

interface SelectedWorkItemProps {
  workItem: Omit<IWorkItem, 'tenant'> | null;
  onEdit: (e?: React.MouseEvent) => void;
}

const SelectedWorkItem: React.FC<SelectedWorkItemProps> = ({ workItem, onEdit }) => {
  if (!workItem) {
    return (
      <div className="flex justify-between items-center p-2">
        <span className="font-bold text-black">Ad-hoc entry (no work item)</span>
        <Button onClick={onEdit} variant="outline" size="sm" id="select-work-item-btn">
          Select Work Item
        </Button>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center p-2">
      <div>
        <div className="font-medium">{workItem.name}</div>
        <div className="text-sm text-gray-500 capitalize">{workItem.type.replace('_', ' ')}</div>
      </div>
      <Button onClick={onEdit} variant="outline" size="sm" id="edit-work-item-button">
        Change
      </Button>
    </div>
  );
};

export default SelectedWorkItem;
