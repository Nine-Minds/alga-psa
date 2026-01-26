'use client';

/**
 * SLA Compliance Gauge Component
 *
 * Visual gauge showing SLA compliance percentage.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';

interface SlaComplianceGaugeProps {
  overallRate: number;
  responseRate: number;
  resolutionRate: number;
  loading?: boolean;
}

export const SlaComplianceGauge: React.FC<SlaComplianceGaugeProps> = ({
  overallRate,
  responseRate,
  resolutionRate,
  loading
}) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>SLA Compliance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse flex flex-col items-center">
            <div className="h-32 w-32 bg-gray-200 rounded-full"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getColor = (rate: number): string => {
    if (rate >= 90) return '#22c55e'; // green-500
    if (rate >= 70) return '#f59e0b'; // amber-500
    return '#ef4444'; // red-500
  };

  const getTextColor = (rate: number): string => {
    if (rate >= 90) return 'text-green-600';
    if (rate >= 70) return 'text-amber-600';
    return 'text-red-600';
  };

  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (overallRate / 100) * circumference;

  return (
    <Card>
      <CardHeader>
        <CardTitle>SLA Compliance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center">
          {/* Circular gauge */}
          <div className="relative h-32 w-32">
            <svg className="transform -rotate-90 h-32 w-32">
              {/* Background circle */}
              <circle
                cx="64"
                cy="64"
                r="45"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="10"
              />
              {/* Progress circle */}
              <circle
                cx="64"
                cy="64"
                r="45"
                fill="none"
                stroke={getColor(overallRate)}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-500 ease-out"
              />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-2xl font-bold ${getTextColor(overallRate)}`}>
                {overallRate}%
              </span>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 w-full space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Response SLA</span>
              <span className={`text-sm font-medium ${getTextColor(responseRate)}`}>
                {responseRate}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Resolution SLA</span>
              <span className={`text-sm font-medium ${getTextColor(resolutionRate)}`}>
                {resolutionRate}%
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
