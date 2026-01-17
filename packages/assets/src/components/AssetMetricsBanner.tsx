import React from 'react';
import { Card } from '@alga-psa/ui/components/Card';
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
import type { AssetSummaryMetrics } from '@alga-psa/types';
import { cn } from 'server/src/lib/utils';

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
  <div 
    className={cn(
      "flex items-center gap-2 px-4 py-2 flex-1 justify-center whitespace-nowrap",
      onClick && "cursor-pointer hover:bg-gray-50 transition-colors"
    )}
    onClick={onClick}
  >
    <span className="text-sm font-bold text-gray-400">
      {label}:
    </span>
    {value}
  </div>
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
  <div className="flex items-center gap-1">
    <span className={cn(
      "text-sm font-semibold flex items-center gap-1",
      color === 'green' && 'text-emerald-600',
      color === 'yellow' && 'text-amber-600',
      color === 'red' && 'text-red-600',
      color === 'gray' && 'text-gray-500',
      color === 'blue' && 'text-primary-600'
    )}>
      [
      {Icon && <Icon size={12} strokeWidth={3} />}
      {text}
      ]
    </span>
  </div>
);

export const AssetMetricsBanner: React.FC<AssetMetricsBannerProps> = ({ 
  metrics,
  isLoading 
}) => {
  if (isLoading || !metrics) {
    return (
      <div className="h-14 w-full animate-pulse bg-gray-50 border border-gray-200 rounded-lg mb-6" />
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
    <Card className="mb-6 bg-white overflow-hidden p-0">
      <div className="flex flex-col lg:flex-row justify-between lg:items-center divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
        <MetricItem 
          label="Health Status" 
          value={<StatusText text={health.text} color={health.color} icon={health.icon} />} 
        />
        
        <MetricItem 
          label="Open Tickets" 
          value={
            <span className="text-sm font-semibold text-primary-600">
              [{metrics.open_tickets_count} Active]
            </span>
          }
          onClick={() => { /* Navigate */ }}
        />

        <MetricItem 
          label="Security Status" 
          value={<StatusText text={security.text} color={security.color} icon={security.icon} />} 
        />

        <MetricItem 
          label="Warranty" 
          value={
            <StatusText text={warranty.text} color={warranty.color} />
          } 
        />
      </div>
    </Card>
  );
};
