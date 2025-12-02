import React from 'react';
import { Badge, Tooltip } from '@mantine/core';
import { 
  Check, 
  AlertTriangle, 
  X, 
  HelpCircle 
} from 'lucide-react';

export type StatusBadgeStatus = 'online' | 'offline' | 'healthy' | 'warning' | 'critical' | 'unknown' | 'secure' | 'at_risk' | 'active' | 'expiring_soon' | 'expired';

interface StatusBadgeProps {
  status: StatusBadgeStatus;
  provider?: string;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  tooltip?: string;
  className?: string;
}

const getStatusConfig = (status: StatusBadgeStatus) => {
  switch (status) {
    case 'online':
    case 'healthy':
    case 'secure':
    case 'active':
      return { color: 'green', icon: Check, label: 'Healthy' };
    case 'warning':
    case 'at_risk':
    case 'expiring_soon':
      return { color: 'yellow', icon: AlertTriangle, label: 'Warning' };
    case 'critical':
    case 'expired':
    case 'offline':
      return { color: 'red', icon: X, label: 'Critical' };
    case 'unknown':
    default:
      return { color: 'gray', icon: HelpCircle, label: 'Unknown' };
  }
};

const getStatusLabel = (status: StatusBadgeStatus) => {
  switch (status) {
    case 'online': return 'Online';
    case 'offline': return 'Offline';
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
      color={config.color} 
      size={size} 
      variant="light"
      className={className}
      leftSection={showIcon && <Icon size={12} />}
    >
      {provider ? `${label} - ${provider}` : label}
    </Badge>
  );

  if (tooltip) {
    return (
      <Tooltip label={tooltip}>
        {content}
      </Tooltip>
    );
  }

  return content;
};