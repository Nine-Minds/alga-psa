import React from 'react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';

interface HoursProgressBarProps {
  percentage: number;
  width?: number | string;
  height?: number;
  showTooltip?: boolean;
  tooltipContent?: React.ReactNode;
  label?: string;
}

export const HoursProgressBar: React.FC<HoursProgressBarProps> = ({
  percentage,
  width = 100,
  height = 10,
  showTooltip = false,
  tooltipContent,
  label
}) => {
  const progressBar = (
    <div className="flex flex-col">
      {label && (
        <div className="text-xs text-gray-600 mb-1">{label}</div>
      )}
      <div className="relative w-full bg-blue-100 rounded-full overflow-hidden" style={{ width: `${width}px`, height: `${height}px` }}>
        <div 
          className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
          style={{ width: `${Math.min(100, percentage)}%` }}
        ></div>
      </div>
    </div>
  );

  if (showTooltip && tooltipContent) {
    return (
      <Tooltip content={tooltipContent}>
        <div className="cursor-help">{progressBar}</div>
      </Tooltip>
    );
  }

  return progressBar;
};

export default HoursProgressBar;
