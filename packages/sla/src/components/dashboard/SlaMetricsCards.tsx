'use client';

/**
 * SLA Metrics Cards Component
 *
 * Displays key SLA metrics in card format for the dashboard.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { TrendingUp, TrendingDown, Clock, AlertTriangle, CheckCircle, PauseCircle } from 'lucide-react';
import { ISlaOverview } from '../../types';

interface SlaMetricsCardsProps {
  data: ISlaOverview | null;
  loading?: boolean;
}

export const SlaMetricsCards: React.FC<SlaMetricsCardsProps> = ({ data, loading }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const metrics = [
    {
      title: 'Overall Compliance',
      value: `${data.compliance.overallRate}%`,
      subtitle: `${data.compliance.totalTickets} tickets tracked`,
      icon: data.compliance.overallRate >= 90 ? CheckCircle : data.compliance.overallRate >= 70 ? TrendingUp : TrendingDown,
      color: data.compliance.overallRate >= 90 ? 'text-green-600' : data.compliance.overallRate >= 70 ? 'text-amber-600' : 'text-red-600',
      bgColor: data.compliance.overallRate >= 90 ? 'bg-green-50' : data.compliance.overallRate >= 70 ? 'bg-amber-50' : 'bg-red-50'
    },
    {
      title: 'Response SLA',
      value: `${data.compliance.responseRate}%`,
      subtitle: `${data.compliance.responseMetCount} met / ${data.compliance.responseBreachedCount} breached`,
      icon: Clock,
      color: data.compliance.responseRate >= 90 ? 'text-green-600' : data.compliance.responseRate >= 70 ? 'text-amber-600' : 'text-red-600',
      bgColor: data.compliance.responseRate >= 90 ? 'bg-green-50' : data.compliance.responseRate >= 70 ? 'bg-amber-50' : 'bg-red-50'
    },
    {
      title: 'At Risk',
      value: data.atRiskCount.toString(),
      subtitle: 'tickets approaching breach',
      icon: AlertTriangle,
      color: data.atRiskCount > 0 ? 'text-amber-600' : 'text-green-600',
      bgColor: data.atRiskCount > 0 ? 'bg-amber-50' : 'bg-green-50'
    },
    {
      title: 'Currently Paused',
      value: data.pausedCount.toString(),
      subtitle: 'tickets with paused SLA',
      icon: PauseCircle,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric, index) => (
        <Card key={index}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{metric.title}</p>
                <p className={`text-2xl font-bold mt-1 ${metric.color}`}>{metric.value}</p>
                <p className="text-xs text-gray-500 mt-1">{metric.subtitle}</p>
              </div>
              <div className={`p-2 rounded-lg ${metric.bgColor}`}>
                <metric.icon className={`h-5 w-5 ${metric.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
