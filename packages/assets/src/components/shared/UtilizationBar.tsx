import React from 'react';
import { Progress } from '@alga-psa/ui/components/Progress';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { cn } from '@alga-psa/ui';

interface UtilizationBarProps {
  value: number | null; // 0-100
  label?: string; // e.g., "45%"
  showLabel?: boolean;
  colorThresholds?: { warning: number; critical: number };
  tooltip?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export const UtilizationBar: React.FC<UtilizationBarProps> = ({
  value,
  label,
  showLabel = true,
  colorThresholds = { warning: 70, critical: 90 },
  tooltip,
  size = 'md',
}) => {
  if (value === null || value === undefined) {
    return <span className="text-sm text-gray-400">N/A</span>;
  }

  let indicatorColor = 'bg-emerald-500';
  if (value >= colorThresholds.critical) {
    indicatorColor = 'bg-red-500';
  } else if (value >= colorThresholds.warning) {
    indicatorColor = 'bg-amber-500';
  }

  const sizeClasses = {
    xs: 'h-1',
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
    xl: 'h-4',
  };

  const content = (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-gray-500">{label}</span>
          <span className="text-xs font-medium text-gray-700">{Math.round(value)}%</span>
        </div>
      )}
      <Progress 
        value={value} 
        className={cn(sizeClasses[size])}
        indicatorClassName={cn(
          indicatorColor,
          value > 90 && 'animate-pulse'
        )}
      />
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip content={tooltip}>
        {content}
      </Tooltip>
    );
  }

  return content;
};
