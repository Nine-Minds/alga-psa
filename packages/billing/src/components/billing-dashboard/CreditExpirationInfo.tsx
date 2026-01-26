'use client'

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { formatCurrency } from '@alga-psa/core';
import { ICreditTracking } from '@alga-psa/types';
import CreditExpirationBadge from '@alga-psa/ui/components/CreditExpirationBadge';
import { formatDateOnly } from '@alga-psa/core';
import { getCreditDetails } from '@alga-psa/billing/actions/creditActions';

interface CreditExpirationInfoProps {
  creditApplied: number;
  invoiceId: string;
}

const CreditExpirationInfo: React.FC<CreditExpirationInfoProps> = ({ creditApplied, invoiceId }) => {
  const [creditDetails, setCreditDetails] = React.useState<ICreditTracking[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchCreditDetails = async () => {
      try {
        setLoading(true);
        
        // Get credit allocations for this invoice
        // In a real implementation, we would have a dedicated server action for this
        // For now, we'll use the existing getCreditDetails action and adapt it
        
        // This would be replaced with a proper server action like getInvoiceCreditAllocations
        const result = await fetch(`/api/invoices/${invoiceId}/credit-allocations`);
        
        if (!result.ok) {
          throw new Error('Failed to fetch credit allocations');
        }
        
        const allocations = await result.json();
        
        // Fetch details for each credit
        const creditDetailsPromises = allocations.map(async (allocation: { credit_id: string, amount: number }) => {
          const creditDetail = await getCreditDetails(allocation.credit_id);
          return creditDetail.credit;
        });
        
        const fetchedCreditDetails = await Promise.all(creditDetailsPromises);
        setCreditDetails(fetchedCreditDetails);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching credit details:', error);
        setError('Failed to load credit details');
        setLoading(false);
      }
    };
    
    if (creditApplied > 0) {
      fetchCreditDetails();
    } else {
      setCreditDetails([]);
      setLoading(false);
    }
  }, [creditApplied, invoiceId]);

  if (creditApplied <= 0) {
    return null;
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Applied Credits</CardTitle>
        <CardDescription>
          Credits applied to this invoice: {formatCurrency(creditApplied)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        ) : error ? (
          <div className="text-red-500">{error}</div>
        ) : creditDetails.length === 0 ? (
          <div className="text-gray-500">No credit details available</div>
        ) : (
          <div className="space-y-4">
            {creditDetails.map((credit) => (
              <div key={credit.credit_id} className="border p-3 rounded-md">
                <div className="flex justify-between mb-1">
                  <span className="font-medium">Credit Amount:</span>
                  <span>{formatCurrency(credit.amount)}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="font-medium">Created:</span>
                  <span>{new Date(credit.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium">Expiration:</span>
                  <div className="flex items-center">
                    {credit.expiration_date
                      ? (
                        <>
                          <span className="mr-2">
                            {new Date(credit.expiration_date).toLocaleDateString()}
                          </span>
                          <CreditExpirationBadge
                            expirationDate={credit.expiration_date}
                            isExpired={credit.is_expired}
                            size="sm"
                          />
                        </>
                      )
                      : <span>Never</span>
                    }
                  </div>
                </div>
              </div>
            ))}
            <div className="mt-2 text-sm text-gray-500">
              Credits are applied in order of expiration date (oldest first)
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CreditExpirationInfo;
