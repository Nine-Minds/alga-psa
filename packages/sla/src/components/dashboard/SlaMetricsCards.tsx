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
              <div className="animate-pulse pt-6">
                <div className="h-4 bg-muted rounded w-1/2 mb-2"></div>
                <div className="h-8 bg-muted rounded w-3/4"></div>
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

  const getStatusClasses = (rate: number) => {
    if (rate >= 90) return { color: 'text-success', bgColor: 'bg-success/10' };
    if (rate >= 70) return { color: 'text-warning', bgColor: 'bg-warning/10' };
    return { color: 'text-error', bgColor: 'bg-error/10' };
  };

  const overallStatus = getStatusClasses(data.compliance.overallRate);
  const responseStatus = getStatusClasses(data.compliance.responseRate);

  const metrics = [
    {
      title: 'Overall Compliance',
      value: `${data.compliance.overallRate}%`,
      subtitle: `${data.compliance.totalTickets} tickets tracked`,
      icon: data.compliance.overallRate >= 90 ? CheckCircle : data.compliance.overallRate >= 70 ? TrendingUp : TrendingDown,
      ...overallStatus
    },
    {
      title: 'Response SLA',
      value: `${data.compliance.responseRate}%`,
      subtitle: `${data.compliance.responseMetCount} met / ${data.compliance.responseBreachedCount} breached`,
      icon: Clock,
      ...responseStatus
    },
    {
      title: 'At Risk',
      value: data.atRiskCount.toString(),
      subtitle: 'tickets approaching breach',
      icon: AlertTriangle,
      color: 'text-warning',
      bgColor: 'bg-warning/10'
    },
    {
      title: 'Currently Paused',
      value: data.pausedCount.toString(),
      subtitle: 'tickets with paused SLA',
      icon: PauseCircle,
      color: 'text-primary',
      bgColor: 'bg-primary/10'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric, index) => (
        <Card key={index}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between pt-6">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{metric.title}</p>
                <p className={`text-2xl font-bold mt-1 ${metric.color}`}>{metric.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{metric.subtitle}</p>
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
