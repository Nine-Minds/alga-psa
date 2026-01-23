'use client';

import React from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ITaskType } from '@alga-psa/types';
import { CheckSquare, Bug, Sparkles, TrendingUp, Flag, BookOpen, GitBranch } from 'lucide-react';

interface TaskTypeSelectorProps {
  value: string;
  taskTypes: ITaskType[];
  onChange: (typeKey: string) => void;
  disabled?: boolean;
}

const taskTypeIcons: Record<string, React.ComponentType<any>> = {
  task: CheckSquare,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  epic: Flag,
  story: BookOpen
};

export const TaskTypeSelector: React.FC<TaskTypeSelectorProps> = ({
  value,
  taskTypes,
  onChange,
  disabled = false
}) => {
  const options = taskTypes.map(type => {
    const Icon = taskTypeIcons[type.type_key] || CheckSquare;
    return {
      value: type.type_key,
      label: (
        <div className="flex items-center gap-2">
          <Icon 
            className="w-4 h-4" 
            style={{ color: type.color || '#6B7280' }}
          />
          <span>{type.type_name}</span>
        </div>
      )
    };
  });

  return (
    <CustomSelect
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      placeholder="Select task type"
      options={options}
    />
  );
};