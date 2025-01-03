'use client';

import React from 'react';
import { Button } from '../ui/Button';
import { IWorkItem } from '../../interfaces/workItem.interfaces';

interface SelectedWorkItemProps {
  workItem: Omit<IWorkItem, 'tenant'> | null;
  onEdit: () => void;
}

const SelectedWorkItem: React.FC<SelectedWorkItemProps> = ({ workItem, onEdit }) => {
  if (!workItem) {
    return (
      <div className="flex justify-between items-center p-2 border rounded-md">
        <span className="text-gray-500">Ad-hoc entry (no work item)</span>
        <Button onClick={onEdit} variant="outline" size="sm">
          Select Work Item
        </Button>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center p-2 border rounded-md">
      <div>
        <div className="font-medium">{workItem.name}</div>
        <div className="text-sm text-gray-500 capitalize">{workItem.type.replace('_', ' ')}</div>
      </div>
      <Button onClick={onEdit} variant="outline" size="sm">
        Change
      </Button>
    </div>
  );
};

export default SelectedWorkItem;
