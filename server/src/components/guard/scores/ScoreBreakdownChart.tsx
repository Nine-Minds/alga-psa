'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';

interface ScoreBreakdownChartProps {
  breakdown: {
    pii_penalty: number;
    cve_penalty: number;
    port_penalty: number;
    cloud_penalty: number;
    email_penalty: number;
  };
  totalScore: number;
}

// Score breakdown chart using pure CSS/SVG (no external charting library needed)
export default function ScoreBreakdownChart({ breakdown, totalScore }: ScoreBreakdownChartProps) {
  const penalties = [
    { name: 'PII Exposure', value: breakdown.pii_penalty, color: '#ef4444', maxColor: '#fecaca' },
    { name: 'CVE Vulnerabilities', value: breakdown.cve_penalty, color: '#f97316', maxColor: '#fed7aa' },
    { name: 'Open Ports', value: breakdown.port_penalty, color: '#eab308', maxColor: '#fef08a' },
    { name: 'Cloud Storage', value: breakdown.cloud_penalty, color: '#3b82f6', maxColor: '#bfdbfe' },
    { name: 'Email Security', value: breakdown.email_penalty, color: '#8b5cf6', maxColor: '#ddd6fe' },
  ];

  const totalPenalty = penalties.reduce((sum, p) => sum + p.value, 0);
  const baseScore = 100;

  // Calculate percentage for pie chart
  const nonZeroPenalties = penalties.filter(p => p.value > 0);

  // SVG Pie Chart
  const renderPieChart = () => {
    if (totalPenalty === 0) {
      return (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="text-4xl font-bold text-green-600">{totalScore}</div>
            <div className="text-sm text-muted-foreground">No penalties</div>
          </div>
        </div>
      );
    }

    let cumulativePercent = 0;
    const slices = nonZeroPenalties.map((penalty) => {
      const percent = penalty.value / totalPenalty;
      const startX = Math.cos(2 * Math.PI * cumulativePercent);
      const startY = Math.sin(2 * Math.PI * cumulativePercent);
      cumulativePercent += percent;
      const endX = Math.cos(2 * Math.PI * cumulativePercent);
      const endY = Math.sin(2 * Math.PI * cumulativePercent);
      const largeArcFlag = percent > 0.5 ? 1 : 0;

      const pathData = [
        `M 0 0`,
        `L ${startX} ${startY}`,
        `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
        `Z`
      ].join(' ');

      return { ...penalty, pathData };
    });

    return (
      <div className="relative">
        <svg viewBox="-1.1 -1.1 2.2 2.2" className="w-48 h-48 mx-auto">
          {slices.map((slice, i) => (
            <path
              key={i}
              d={slice.pathData}
              fill={slice.color}
              className="hover:opacity-80 transition-opacity"
            />
          ))}
          {/* Center circle for donut effect */}
          <circle cx="0" cy="0" r="0.6" fill="white" className="dark:fill-gray-900" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl font-bold">{totalScore}</div>
            <div className="text-xs text-muted-foreground">Score</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Score Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <div>{renderPieChart()}</div>

          {/* Legend and Details */}
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground mb-2">
              Base Score: {baseScore} - Penalties: {totalPenalty} = <strong>{totalScore}</strong>
            </div>
            {penalties.map((penalty, i) => (
              <div key={i} className="flex items-center gap-3">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: penalty.color }}
                />
                <div className="flex-1">
                  <div className="flex justify-between text-sm">
                    <span>{penalty.name}</span>
                    <span className="font-medium">-{penalty.value}</span>
                  </div>
                  <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min((penalty.value / 50) * 100, 100)}%`,
                        backgroundColor: penalty.color
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
