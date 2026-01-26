'use client'

import React from 'react';
import { Badge } from './Badge';
import { Tooltip } from './Tooltip';
import { format } from 'date-fns';

export type CreditStatus = 'active' | 'expiring-soon' | 'expired' | 'no-expiration';

interface CreditExpirationBadgeProps {
  expirationDate?: string;
  isExpired?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  daysUntilWarning?: number;
}

export const CreditExpirationBadge = ({
  expirationDate,
  isExpired,
  size = 'md',
  showTooltip = true,
  daysUntilWarning = 30
}: CreditExpirationBadgeProps) => {
  const getStatus = (): CreditStatus => {
    if (isExpired) return 'expired';
    if (!expirationDate) return 'no-expiration';
    
    const expDate = new Date(expirationDate);
    const today = new Date();
    
    // Set both dates to midnight for accurate day calculation
    expDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    const diffTime = expDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) return 'expired';
    if (diffDays <= daysUntilWarning) return 'expiring-soon';
    return 'active';
  };
  
  const status = getStatus();
  
  const getVariant = () => {
    switch (status) {
      case 'active': return 'success';
      case 'expiring-soon': return 'warning';
      case 'expired': return 'error';
      case 'no-expiration': return 'default';
      default: return 'default';
    }
  };
  
  const getLabel = () => {
    switch (status) {
      case 'active': return 'Active';
      case 'expiring-soon': return 'Expiring Soon';
      case 'expired': return 'Expired';
      case 'no-expiration': return 'No Expiration';
      default: return 'Unknown';
    }
  };
  
  const getTooltipContent = () => {
    if (status === 'no-expiration') return 'This credit has no expiration date';
    if (status === 'expired') return `Expired on ${expirationDate ? format(new Date(expirationDate), 'yyyy-MM-dd') : 'unknown date'}`;
    if (status === 'expiring-soon') {
      const expDate = new Date(expirationDate!);
      const today = new Date();
      
      expDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      
      const diffTime = expDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      return `Expires in ${diffDays} day${diffDays !== 1 ? 's' : ''} on ${format(expDate, 'yyyy-MM-dd')}`;
    }
    return `Expires on ${expirationDate ? format(new Date(expirationDate), 'yyyy-MM-dd') : 'unknown date'}`;
  };
  
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-2.5 py-1.5'
  };
  
  const badge = (
    <Badge 
      variant={getVariant() as any} 
      className={`${sizeClasses[size]} font-medium`}
    >
      {getLabel()}
    </Badge>
  );
  
  if (!showTooltip) return badge;
  
  return (
    <Tooltip content={getTooltipContent()}>
      {badge}
    </Tooltip>
  );
};

export default CreditExpirationBadge;
