import React from 'react';
import { Paper, Text, Group, Divider } from '@mantine/core';
import { 
  Check, 
  AlertTriangle, 
  X, 
  HelpCircle, 
  Ticket, 
  ShieldCheck, 
  Shield, 
  CalendarClock,
  AlertCircle 
} from 'lucide-react';
import { AssetSummaryMetrics } from '../../interfaces/asset.interfaces';

interface AssetMetricsBannerProps {
  metrics: AssetSummaryMetrics | undefined;
  isLoading?: boolean;
}

const MetricItem = ({ 
  label, 
  value, 
  onClick 
}: { 
  label: string; 
  value: React.ReactNode; 
  onClick?: () => void;
}) => (
  <Group 
    gap="xs" 
    className={`px-4 py-2 ${onClick ? 'cursor-pointer hover:bg-gray-50 rounded transition-colors' : ''}`}
    onClick={onClick}
  >
    <Text size="sm" fw={700} c="dimmed">
      {label}:
    </Text>
    {value}
  </Group>
);

const StatusText = ({ 
  text, 
  color, 
  icon: Icon 
}: { 
  text: string; 
  color: string; 
  icon?: any;
}) => (
  <Group gap={4}>
    <Text 
      size="sm" 
      fw={600} 
      className={`text-${color}-600 flex items-center gap-1`}
    >
      [
      {Icon && <Icon size={12} strokeWidth={3} />}
      {text}
      ]
    </Text>
  </Group>
);

export const AssetMetricsBanner: React.FC<AssetMetricsBannerProps> = ({ 
  metrics,
  isLoading 
}) => {
  if (isLoading || !metrics) {
    return (
      <Paper p="md" withBorder className="h-14 animate-pulse bg-gray-50 mb-6" />
    );
  }

  // Health Status Config
  const getHealthConfig = (status: string) => {
    switch (status) {
      case 'healthy': return { icon: Check, color: 'green', text: 'Healthy' };
      case 'warning': return { icon: AlertTriangle, color: 'yellow', text: 'Warning' };
      case 'critical': return { icon: AlertCircle, color: 'red', text: 'Critical' };
      default: return { icon: HelpCircle, color: 'gray', text: 'Unknown' };
    }
  };
  const health = getHealthConfig(metrics.health_status);

  // Security Status Config
  const getSecurityConfig = (status: string, issuesCount: number) => {
    switch (status) {
      case 'secure': return { icon: ShieldCheck, color: 'green', text: 'Secure' };
      case 'at_risk': return { icon: AlertTriangle, color: 'yellow', text: `${issuesCount} Missing Patches` };
      case 'critical': return { icon: AlertCircle, color: 'red', text: 'Critical' };
      default: return { icon: ShieldCheck, color: 'gray', text: 'Unknown' };
    }
  };
  const security = getSecurityConfig(metrics.security_status, metrics.security_issues.length);

  // Warranty Status Config
  const getWarrantyConfig = (status: string, days: number | null) => {
    if (status === 'active' && days !== null) {
      return { text: `Expires in ${days} Days`, color: 'gray' }; 
    }
    switch (status) {
      case 'expiring_soon': return { text: `Expires in ${days} Days`, color: 'yellow' };
      case 'expired': return { text: 'Expired', color: 'red' };
      default: return { text: 'Unknown', color: 'gray' };
    }
  };
  const warranty = getWarrantyConfig(metrics.warranty_status, metrics.warranty_days_remaining);

  return (
    <Paper withBorder p="xs" className="mb-6 bg-white">
      <div className="flex flex-col lg:flex-row justify-between lg:items-center divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
        <div className="flex-1 flex justify-center">
          <MetricItem 
            label="Health Status" 
            value={<StatusText text={health.text} color={health.color} icon={health.icon} />} 
          />
        </div>
        
        <div className="flex-1 flex justify-center">
          <MetricItem 
            label="Open Tickets" 
            value={
              <Text size="sm" fw={600} className="text-blue-600">
                [{metrics.open_tickets_count} Active]
              </Text>
            }
            onClick={() => { /* Navigate */ }}
          />
        </div>

        <div className="flex-1 flex justify-center">
          <MetricItem 
            label="Security Status" 
            value={<StatusText text={security.text} color={security.color} icon={security.icon} />} 
          />
        </div>

        <div className="flex-1 flex justify-center">
          <MetricItem 
            label="Warranty" 
            value={
              <Text size="sm" fw={600} className={warranty.color !== 'gray' ? `text-${warranty.color}-600` : ''}>
                [{warranty.text}]
              </Text>
            } 
          />
        </div>
      </div>
    </Paper>
  );
};