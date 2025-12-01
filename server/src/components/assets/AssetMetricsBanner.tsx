import React from 'react';
import { SimpleGrid, Paper, Text, Group } from '@mantine/core';
import { 
  Activity, 
  Ticket, 
  ShieldCheck, 
  Shield, 
  CalendarClock,
  AlertTriangle,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { AssetSummaryMetrics } from '../../interfaces/asset.interfaces';

interface AssetMetricsBannerProps {
  metrics: AssetSummaryMetrics | undefined;
  isLoading?: boolean;
}

const MetricCard = ({ 
  label, 
  value, 
  icon: Icon, 
  color,
  subtext,
  onClick
}: { 
  label: string; 
  value: React.ReactNode; 
  icon: any; 
  color: string;
  subtext?: string;
  onClick?: () => void;
}) => (
  <Paper 
    p="md" 
    withBorder 
    className={`bg-white dark:bg-gray-800 ${onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors' : ''}`}
    onClick={onClick}
  >
    <Group justify="space-between" align="flex-start" mb="xs">
      <Text size="xs" c="dimmed" fw={700} tt="uppercase">
        {label}
      </Text>
      <Icon size={16} className={`text-${color}-500`} />
    </Group>
    
    <Group align="center" gap="xs">
      {value}
    </Group>
    
    {subtext && (
      <Text size="xs" c="dimmed" mt={4}>
        {subtext}
      </Text>
    )}
  </Paper>
);

export const AssetMetricsBanner: React.FC<AssetMetricsBannerProps> = ({ 
  metrics,
  isLoading 
}) => {
  if (isLoading || !metrics) {
    return (
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md" className="mb-6">
        {[1, 2, 3, 4].map(i => (
          <Paper key={i} p="md" withBorder className="h-24 animate-pulse bg-gray-50" />
        ))}
      </SimpleGrid>
    );
  }

  // Health Status
  const getHealthConfig = (status: string) => {
    switch (status) {
      case 'healthy': return { icon: CheckCircle, color: 'green', text: 'Healthy' };
      case 'warning': return { icon: AlertTriangle, color: 'yellow', text: 'Warning' };
      case 'critical': return { icon: AlertCircle, color: 'red', text: 'Critical' };
      default: return { icon: Activity, color: 'gray', text: 'Unknown' };
    }
  };
  const health = getHealthConfig(metrics.health_status);

  // Security Status
  const getSecurityConfig = (status: string) => {
    switch (status) {
      case 'secure': return { icon: ShieldCheck, color: 'green', text: 'Secure' };
      case 'at_risk': return { icon: Shield, color: 'yellow', text: 'At Risk' };
      case 'critical': return { icon: Shield, color: 'red', text: 'Critical' };
      default: return { icon: ShieldCheck, color: 'gray', text: 'Unknown' };
    }
  };
  const security = getSecurityConfig(metrics.security_status);

  // Warranty Status
  const getWarrantyConfig = (status: string) => {
    switch (status) {
      case 'active': return { color: 'green' };
      case 'expiring_soon': return { color: 'yellow' };
      case 'expired': return { color: 'red' };
      default: return { color: 'gray' };
    }
  };
  const warrantyColor = getWarrantyConfig(metrics.warranty_status).color;

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md" className="mb-6">
      <MetricCard
        label="Health Status"
        icon={health.icon}
        color={health.color}
        value={
          <Group gap="xs">
            <Text fw={700} className={`text-${health.color}-600`}>
              {health.text}
            </Text>
          </Group>
        }
        subtext={metrics.health_reason || 'No issues detected'}
      />

      <MetricCard
        label="Open Tickets"
        icon={Ticket}
        color="blue"
        value={
          <Text fw={700} size="xl">
            {metrics.open_tickets_count}
          </Text>
        }
        subtext="Active tickets"
        onClick={() => { /* Navigate to tickets tab */ }}
      />

      <MetricCard
        label="Security Status"
        icon={security.icon}
        color={security.color}
        value={
          <Text fw={700} className={`text-${security.color}-600`}>
            {security.text}
          </Text>
        }
        subtext={metrics.security_issues.length > 0 
          ? `${metrics.security_issues.length} issues detected` 
          : 'All systems operational'}
      />

      <MetricCard
        label="Warranty"
        icon={CalendarClock}
        color={warrantyColor}
        value={
          <Text fw={700} size="xl">
            {metrics.warranty_days_remaining !== null 
              ? `${metrics.warranty_days_remaining} Days`
              : 'N/A'}
          </Text>
        }
        subtext={metrics.warranty_status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
      />
    </SimpleGrid>
  );
};