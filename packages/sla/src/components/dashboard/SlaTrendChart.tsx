'use client';

/**
 * SLA Trend Chart Component
 *
 * Line chart showing SLA compliance over time.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ISlaTrendDataPoint } from '../../types';

interface SlaTrendChartProps {
  data: ISlaTrendDataPoint[];
  loading?: boolean;
}

export const SlaTrendChart: React.FC<SlaTrendChartProps> = ({ data, loading }) => {
  const { t } = useTranslation('msp/settings');
  const { formatDate } = useFormatters();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('sla.dashboard.trendChart.title', { defaultValue: 'Compliance Trend' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-64 bg-gray-100 rounded"></div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('sla.dashboard.trendChart.title', { defaultValue: 'Compliance Trend' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-gray-500">
            {t('sla.dashboard.trendChart.empty', { defaultValue: 'No trend data available for the selected period' })}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Format data for chart; formatDate follows the app locale, 'en-US' did not
  const chartData = data.map(point => ({
    date: formatDate(new Date(point.date), { month: 'short', day: 'numeric' }),
    compliance: point.complianceRate,
    tickets: point.ticketCount,
    breaches: point.breachCount
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sla.dashboard.trendChart.title', { defaultValue: 'Compliance Trend' })}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 12, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
                formatter={(value: number, name: string) => {
                  if (name === 'compliance') return [`${value}%`, t('sla.dashboard.trendChart.compliance', { defaultValue: 'Compliance' })];
                  if (name === 'tickets') return [value, t('sla.dashboard.trendChart.tickets', { defaultValue: 'Tickets' })];
                  if (name === 'breaches') return [value, t('sla.dashboard.trendChart.breaches', { defaultValue: 'Breaches' })];
                  return [value, name];
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="compliance"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ fill: '#22c55e', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                name={t('sla.dashboard.trendChart.compliancePercent', { defaultValue: 'Compliance %' })}
              />
              <Line
                type="monotone"
                dataKey="breaches"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ fill: '#ef4444', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                name={t('sla.dashboard.trendChart.breaches', { defaultValue: 'Breaches' })}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
