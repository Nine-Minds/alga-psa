'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrency } from '@alga-psa/core';
import { ICreditTracking } from '@alga-psa/types';
import CreditExpirationBadge from '@alga-psa/ui/components/CreditExpirationBadge';
import { formatDateOnly } from '@alga-psa/core';
import { listClientCredits, applyCreditToInvoice } from '@alga-psa/billing/actions/creditActions';
import { DataTable } from '@alga-psa/ui/components/DataTable';

interface CreditApplicationUIProps {
  clientId: string;
  invoiceId?: string;
  invoiceAmount?: number;
  onApplyCredit: (creditId: string, amount: number) => Promise<void>;
  onCancel: () => void;
}

const CreditApplicationUI: React.FC<CreditApplicationUIProps> = ({
  clientId,
  invoiceId,
  invoiceAmount = 0,
  onApplyCredit,
  onCancel
}) => {
  const { t } = useTranslation('msp/credits');
  const [availableCredits, setAvailableCredits] = useState<ICreditTracking[]>([]);
  const [selectedCreditId, setSelectedCreditId] = useState<string>('');
  const [applicationAmount, setApplicationAmount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [applying, setApplying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCredits, setTotalCredits] = useState<number>(0);

  // Fetch available credits
  useEffect(() => {
    const fetchCredits = async () => {
      try {
        setLoading(true);
        
        // Fetch real credits from the server using the server action
        const result = await listClientCredits(clientId, false, page, 10);
        
        setAvailableCredits(result.credits);
        setTotalPages(result.totalPages);
        setTotalCredits(result.total);
        
        // If there are credits and an invoice amount, pre-select the first credit
        if (result.credits.length > 0 && invoiceAmount > 0 && !selectedCreditId) {
          setSelectedCreditId(result.credits[0].credit_id);
          
          // Set default application amount (up to invoice amount or available credit)
          const firstCredit = result.credits[0];
          setApplicationAmount(Math.min(invoiceAmount, firstCredit.remaining_amount));
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching credits:', error);
        setError(t('application.failedToLoadCredits', { defaultValue: 'Failed to load available credits' }));
        setLoading(false);
      }
    };
    
    fetchCredits();
  }, [clientId, invoiceAmount, page, selectedCreditId]);

  const handleCreditSelection = (creditId: string) => {
    setSelectedCreditId(creditId);
    
    // Update application amount based on selected credit
    const selectedCredit = availableCredits.find(c => c.credit_id === creditId);
    if (selectedCredit) {
      setApplicationAmount(Math.min(invoiceAmount || selectedCredit.remaining_amount, selectedCredit.remaining_amount));
    } else {
      setApplicationAmount(0);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (isNaN(value)) {
      setApplicationAmount(0);
      return;
    }
    
    const selectedCredit = availableCredits.find(c => c.credit_id === selectedCreditId);
    if (selectedCredit) {
      // Ensure amount doesn't exceed remaining credit or invoice amount
      const maxAmount = invoiceAmount
        ? Math.min(invoiceAmount, selectedCredit.remaining_amount)
        : selectedCredit.remaining_amount;
      
      setApplicationAmount(Math.min(value, maxAmount));
    }
  };

  const handleApplyCredit = async () => {
    if (!selectedCreditId || applicationAmount <= 0) {
      setError(t('application.selectCreditError', { defaultValue: 'Please select a credit and enter a valid amount' }));
      return;
    }
    
    setApplying(true);
    setError(null);
    
    try {
      if (invoiceId) {
        // If we have an invoiceId, use the server action directly
        await applyCreditToInvoice(clientId, invoiceId, applicationAmount);
        // Call the parent callback to handle UI updates
        await onApplyCredit(selectedCreditId, applicationAmount);
      } else {
        // Otherwise use the callback provided by the parent
        await onApplyCredit(selectedCreditId, applicationAmount);
      }
    } catch (err) {
      console.error('Error applying credit:', err);
      setError(t('application.failedToApply', { defaultValue: 'Failed to apply credit' }));
    } finally {
      setApplying(false);
    }
  };

  const getTotalAvailableCredit = () => {
    return availableCredits.reduce((sum, credit) => sum + credit.remaining_amount, 0);
  };

  // Define columns for the DataTable
  const columns = [
    {
      title: t('columns.amountAvailable', { defaultValue: 'Amount Available' }),
      dataIndex: 'remaining_amount',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: t('columns.created', { defaultValue: 'Created' }),
      dataIndex: 'created_at',
      render: (value: string) => formatDateOnly(new Date(value))
    },
    {
      title: t('columns.expiration', { defaultValue: 'Expiration' }),
      dataIndex: 'expiration_date',
      render: (value: string | undefined, record: ICreditTracking) => (
        <div className="flex items-center">
          {value ? (
            <>
              <span className="mr-2">{formatDateOnly(new Date(value))}</span>
              <CreditExpirationBadge
                expirationDate={value}
                isExpired={record.is_expired}
                size="sm"
              />
            </>
          ) : (
            <span>{t('expiration.never', { defaultValue: 'Never' })}</span>
          )}
        </div>
      )
    },
    {
      title: t('columns.select', { defaultValue: 'Select' }),
      dataIndex: 'credit_id',
      render: (value: string, record: ICreditTracking) => (
        <Button
          id={`select-credit-${value}`}
          variant={selectedCreditId === value ? "default" : "outline"}
          size="sm"
          onClick={() => handleCreditSelection(value)}
        >
          {selectedCreditId === value
            ? t('actions.selected', { defaultValue: 'Selected' })
            : t('actions.select', { defaultValue: 'Select' })}
        </Button>
      )
    }
  ];

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t('application.title', { defaultValue: 'Apply Credit' })}</CardTitle>
        <CardDescription>
          {invoiceId
            ? t('application.applyToInvoice', { defaultValue: 'Apply available credits to this invoice' })
            : t('application.applyToBalance', { defaultValue: 'Apply credits to reduce customer balance' })}
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        {loading && availableCredits.length === 0 ? (
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-[rgb(var(--color-border-200))] rounded w-3/4"></div>
            <div className="h-4 bg-[rgb(var(--color-border-200))] rounded w-1/2"></div>
          </div>
        ) : error ? (
          <div className="text-red-500">{error}</div>
        ) : availableCredits.length === 0 ? (
          <div className="text-muted-foreground">
            {t('application.noCreditsAvailable', { defaultValue: 'No credits available for this client' })}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                {t('application.totalAvailableCredit', { defaultValue: 'Total Available Credit:' })}
              </span>
              <span>{formatCurrency(getTotalAvailableCredit())}</span>
            </div>
            
            {invoiceAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  {t('application.invoiceAmount', { defaultValue: 'Invoice Amount:' })}
                </span>
                <span>{formatCurrency(invoiceAmount)}</span>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="credit-select">
                {t('application.selectCreditToApply', { defaultValue: 'Select Credit to Apply' })}
              </Label>
              <DataTable
                id="credit-application-table"
                data={availableCredits}
                columns={columns}
                pagination={true}
                onPageChange={setPage}
                currentPage={page}
                totalItems={totalCredits}
                pageSize={10}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="amount-input">
                {t('application.amountToApply', { defaultValue: 'Amount to Apply' })}
              </Label>
              <Input
                id="amount-input"
                type="number"
                min={0}
                step={0.01}
                value={applicationAmount}
                onChange={handleAmountChange}
                disabled={!selectedCreditId}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                {t('application.creditOrderNote', {
                  defaultValue: 'Credits are applied in order of expiration date (oldest first)',
                })}
              </p>
            </div>
          </div>
        )}
      </CardContent>
      
      <CardFooter className="flex justify-between">
        <Button
          id="cancel-credit-application"
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={applying}
        >
          {t('actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          id="apply-credit-button"
          type="button"
          onClick={handleApplyCredit}
          disabled={applying || !selectedCreditId || applicationAmount <= 0}
        >
          {applying
            ? t('actions.applying', { defaultValue: 'Applying...' })
            : t('actions.applyCredit', { defaultValue: 'Apply Credit' })}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default CreditApplicationUI;
