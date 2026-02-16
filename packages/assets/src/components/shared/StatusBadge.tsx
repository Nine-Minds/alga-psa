import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { cn } from '@alga-psa/ui';
import { 
  Check, 
  AlertTriangle, 
  X, 
  HelpCircle 
} from 'lucide-react';

export type StatusBadgeStatus = 'online' | 'offline' | 'healthy' | 'warning' | 'critical' | 'unknown' | 'secure' | 'at_risk' | 'active' | 'expiring_soon' | 'expired';
// Note: 'overdue' is distinct from 'offline' for Tactical RMM and other providers that support it.
export type RmmConnectivityStatus = 'online' | 'offline' | 'overdue' | 'unknown';

interface StatusBadgeProps {
  status: StatusBadgeStatus | RmmConnectivityStatus;
  provider?: string;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  tooltip?: string;
  className?: string;
}

const getStatusConfig = (status: StatusBadgeStatus | RmmConnectivityStatus) => {
  switch (status) {
    case 'online':
    case 'healthy':
    case 'secure':
    case 'active':
      return { variant: 'success' as const, icon: Check, label: 'Healthy' };
    case 'overdue':
      return { variant: 'warning' as const, icon: AlertTriangle, label: 'Overdue' };
    case 'warning':
    case 'at_risk':
    case 'expiring_soon':
      return { variant: 'warning' as const, icon: AlertTriangle, label: 'Warning' };
    case 'critical':
    case 'expired':
    case 'offline':
      return { variant: 'error' as const, icon: X, label: 'Critical' };
    case 'unknown':
    default:
      return { variant: 'default-muted' as const, icon: HelpCircle, label: 'Unknown' };
  }
};

const getStatusLabel = (status: StatusBadgeStatus | RmmConnectivityStatus) => {
  switch (status) {
    case 'online': return 'Online';
    case 'offline': return 'Offline';
    case 'overdue': return 'Overdue';
    case 'healthy': return 'Healthy';
    case 'warning': return 'Warning';
    case 'critical': return 'Critical';
    case 'unknown': return 'Unknown';
    case 'secure': return 'Secure';
    case 'at_risk': return 'At Risk';
    case 'active': return 'Active';
    case 'expiring_soon': return 'Expiring Soon';
    case 'expired': return 'Expired';
    default: return status;
  }
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ 
  status, 
  provider, 
  size = 'md', 
  showIcon = true,
  tooltip,
  className 
}) => {
  const config = getStatusConfig(status);
  const label = getStatusLabel(status);
  const Icon = config.icon;

  const content = (
    <Badge
      variant={config.variant}
      className={cn(
        'gap-1.5 py-1 px-3',
        size === 'sm' && 'text-[10px] px-2 py-0.5',
        size === 'lg' && 'text-sm px-4 py-1.5',
        className
      )}
    >
      {showIcon && <Icon size={size === 'sm' ? 10 : size === 'lg' ? 14 : 12} />}
      {provider ? `${label} - ${provider}` : label}
    </Badge>
  );

  if (tooltip) {
    return (
      <Tooltip content={tooltip}>
        {content}
      </Tooltip>
    );
  }

  return content;
};
