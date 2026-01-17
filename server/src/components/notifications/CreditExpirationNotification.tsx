'use client'

import React from 'react';
import { Bell, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import { formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import Link from 'next/link';

export interface CreditExpirationNotificationProps {
  clientId: string;
  clientName: string;
  expiringCredits: Array<{
    creditId: string;
    amount: number;
    remainingAmount: number;
    expirationDate: string;
    daysUntilExpiration: number;
  }>;
  onDismiss?: (notificationId: string) => void;
  notificationId: string;
}

const CreditExpirationNotification: React.FC<CreditExpirationNotificationProps> = ({
  clientId,
  clientName,
  expiringCredits,
  onDismiss,
  notificationId
}) => {
  const totalAmount = expiringCredits.reduce((sum, credit) => sum + credit.remainingAmount, 0);
  const earliestExpiration = expiringCredits.reduce(
    (earliest, credit) => {
      const date = new Date(credit.expirationDate);
      return earliest < date ? earliest : date;
    },
    new Date(expiringCredits[0].expirationDate)
  );
  
  const urgencyLevel = (): 'high' | 'medium' | 'low' => {
    const minDays = Math.min(...expiringCredits.map(c => c.daysUntilExpiration));
    if (minDays <= 3) return 'high';
    if (minDays <= 7) return 'medium';
    return 'low';
  };
  
  const urgency = urgencyLevel();
  
  const getUrgencyIcon = () => {
    switch (urgency) {
      case 'high':
        return <AlertTriangle className="h-5 w-5 text-red-500" />;
      case 'medium':
        return <Clock className="h-5 w-5 text-amber-500" />;
      case 'low':
        return <Bell className="h-5 w-5 text-blue-500" />;
    }
  };
  
  const getUrgencyColor = () => {
    switch (urgency) {
      case 'high': return 'border-red-200 bg-red-50';
      case 'medium': return 'border-amber-200 bg-amber-50';
      case 'low': return 'border-blue-200 bg-blue-50';
    }
  };
  
  return (
    <Card className={`mb-4 ${getUrgencyColor()}`}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center">
            {getUrgencyIcon()}
            <CardTitle className="ml-2 text-lg">Credits Expiring Soon</CardTitle>
          </div>
          {onDismiss && (
            <Button 
              id="dismiss-notification" 
              variant="ghost" 
              size="sm" 
              onClick={() => onDismiss(notificationId)}
              className="h-8 w-8 p-0"
            >
              <span className="sr-only">Dismiss</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </Button>
          )}
        </div>
        <CardDescription>
          {expiringCredits.length} credit{expiringCredits.length !== 1 ? 's' : ''} for {clientName} will expire soon
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Total Amount:</span>
            <span className="font-bold">{formatCurrency(totalAmount)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="font-medium">Earliest Expiration:</span>
            <span>{formatDateOnly(earliestExpiration)}</span>
          </div>
          {expiringCredits.length > 1 && (
            <div className="mt-2 text-xs text-gray-500">
              {expiringCredits.length} credits will expire between {formatDateOnly(earliestExpiration)} and {
                formatDateOnly(new Date(Math.max(...expiringCredits.map(c => new Date(c.expirationDate).getTime()))))
              }
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <Link href={`/msp/billing/credits?client=${clientId}`} passHref>
          <Button id="view-credits-button" variant="soft" className="w-full">
            View Credits
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
};

export default CreditExpirationNotification;