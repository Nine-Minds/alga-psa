import React from 'react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';

interface DonutChartProps {
  percentage: number;
  tooltipContent?: React.ReactNode;
}

export const DonutChart: React.FC<DonutChartProps> = ({ percentage, tooltipContent }) => {
  const strokeWidth = 10;
  const size = 40;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return tooltipContent ? (
    <Tooltip content={tooltipContent}>
      <div className="relative cursor-help w-fit">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E9D5FF"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#9333EA"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dy=".3em"
            fontSize="12"
            fontWeight="bold"
            fill="#4B5563"
          >
          </text>
        </svg>
      </div>
    </Tooltip>
  ) : (
    <div className="relative w-fit">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E9D5FF"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#9333EA"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dy=".3em"
          fontSize="12"
          fontWeight="bold"
          fill="#4B5563"
        >
        </text>
      </svg>
    </div>
  );
};

export default DonutChart;
