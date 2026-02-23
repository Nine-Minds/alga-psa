'use client';

/**
 * SLA Breach Chart Component
 *
 * Bar chart showing breaches by priority.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import { ISlaBreachRateByDimension } from '../../types';

interface SlaBreachChartProps {
  data: ISlaBreachRateByDimension[];
  title?: string;
  loading?: boolean;
}

export const SlaBreachChart: React.FC<SlaBreachChartProps> = ({
  data,
  title = 'Breaches by Priority',
  loading
}) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-64 bg-muted rounded"></div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            No breach data available
          </div>
        </CardContent>
      </Card>
    );
  }

  // Read theme-aware colors from CSS variables
  const getCssColor = (varName: string): string => {
    if (typeof window === 'undefined') return '';
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return raw ? `rgb(${raw})` : '';
  };

  const successColor = getCssColor('--color-status-success');
  const warningColor = getCssColor('--color-status-warning');
  const errorColor = getCssColor('--color-status-error');
  const borderColor = getCssColor('--color-border-200');
  const textColor = getCssColor('--color-text-500');
  const cardBg = getCssColor('--color-card');

  // Format data for chart
  const chartData = data.map(item => ({
    name: item.dimensionName,
    breachRate: item.breachRate,
    breached: item.breachedCount,
    total: item.totalTickets
  }));

  const getBarColor = (rate: number): string => {
    if (rate <= 10) return successColor;
    if (rate <= 25) return warningColor;
    return errorColor;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: textColor }}
                tickLine={false}
                axisLine={{ stroke: borderColor }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: textColor }}
                tickLine={false}
                axisLine={{ stroke: borderColor }}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                cursor={{ fill: `${borderColor}`, opacity: 0.3 }}
                contentStyle={{
                  backgroundColor: cardBg,
                  color: textColor,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '8px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
                labelStyle={{ color: textColor }}
                itemStyle={{ color: textColor }}
                formatter={(value: number, name: string, props: { payload?: { breached: number; total: number } }) => {
                  if (name === 'breachRate' && props.payload) {
                    return [`${value}% (${props.payload.breached}/${props.payload.total})`, 'Breach Rate'];
                  }
                  return [value, name];
                }}
              />
              <Bar dataKey="breachRate" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getBarColor(entry.breachRate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
