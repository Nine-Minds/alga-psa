'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel'; // Import SwitchWithLabel
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

export interface ClientContractDialogSubmission {
  startDate: string;
  endDate: string | null;
  renewal_mode?: 'none' | 'manual' | 'auto';
  notice_period_days?: number;
  renewal_term_months?: number;
  use_tenant_renewal_defaults?: boolean;
}

interface ClientContractDialogProps {
  onContractAssigned: (payload: ClientContractDialogSubmission) => void | Promise<void>;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  isOpen?: boolean;
  initialStartDate?: string;
  initialEndDate?: string | null;
  initialRenewalMode?: 'none' | 'manual' | 'auto' | null;
  initialNoticePeriodDays?: number;
  initialRenewalTermMonths?: number;
  initialUseTenantRenewalDefaults?: boolean;
  contractLineNames?: string[];
}

export function ClientContractDialog({
  onContractAssigned,
  onClose,
  triggerButton,
  isOpen = false,
  initialStartDate,
  initialEndDate,
  initialRenewalMode,
  initialNoticePeriodDays,
  initialRenewalTermMonths,
  initialUseTenantRenewalDefaults,
  contractLineNames
}: ClientContractDialogProps) {
  const normalizeRenewalMode = (
    value?: 'none' | 'manual' | 'auto' | null
  ): 'none' | 'manual' | 'auto' => {
    if (value === 'none' || value === 'manual' || value === 'auto') {
      return value;
    }
    return 'manual';
  };

  const [open, setOpen] = useState(isOpen);
  // Safely initialize startDate: check if initialStartDate is a non-empty string
  const [startDate, setStartDate] = useState<string>(() => {
    const dateStr = typeof initialStartDate === 'string' && initialStartDate ? initialStartDate.split('T')[0] : null;
    return dateStr || new Date().toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string | null>(initialEndDate || null);
  // Safely initialize isOngoing: check if initialEndDate is a non-empty string
  const [isOngoing, setIsOngoing] = useState<boolean>(!(typeof initialEndDate === 'string' && initialEndDate));
  const [renewalMode, setRenewalMode] = useState<'none' | 'manual' | 'auto'>(() =>
    normalizeRenewalMode(initialRenewalMode)
  );
  const [useTenantRenewalDefaults, setUseTenantRenewalDefaults] = useState<boolean>(
    initialUseTenantRenewalDefaults ?? true
  );
  const [noticePeriodDays, setNoticePeriodDays] = useState<string>(() =>
    initialNoticePeriodDays === undefined || initialNoticePeriodDays === null
      ? ''
      : String(initialNoticePeriodDays)
  );
  const [renewalTermMonths, setRenewalTermMonths] = useState<string>(() =>
    initialRenewalTermMonths === undefined || initialRenewalTermMonths === null
      ? ''
      : String(initialRenewalTermMonths)
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(isOpen);
  }, [isOpen]);

  useEffect(() => {
    const nextStartDate =
      typeof initialStartDate === 'string' && initialStartDate
        ? initialStartDate.split('T')[0]
        : new Date().toISOString().split('T')[0];
    setStartDate(nextStartDate);
    setEndDate(initialEndDate || null);
    setIsOngoing(!(typeof initialEndDate === 'string' && initialEndDate));
    setRenewalMode(normalizeRenewalMode(initialRenewalMode));
    setUseTenantRenewalDefaults(initialUseTenantRenewalDefaults ?? true);
    setNoticePeriodDays(
      initialNoticePeriodDays === undefined || initialNoticePeriodDays === null
        ? ''
        : String(initialNoticePeriodDays)
    );
    setRenewalTermMonths(
      initialRenewalTermMonths === undefined || initialRenewalTermMonths === null
        ? ''
        : String(initialRenewalTermMonths)
    );
    setError(null);
  }, [
    initialStartDate,
    initialEndDate,
    initialRenewalMode,
    initialNoticePeriodDays,
    initialRenewalTermMonths,
    initialUseTenantRenewalDefaults,
    isOpen
  ]);

  const handleSubmit = async (e: React.FormEvent) => { // Make async
    e.preventDefault();
    setError(null); // Clear previous errors

    if (!startDate) {
      setError('Start date is required');
      return;
    }

    if (!isOngoing && !endDate) {
      setError('End date is required when not ongoing');
      return;
    }

    if (!isOngoing && endDate && new Date(endDate) <= new Date(startDate)) {
      setError('End date must be after start date');
      return;
    }

    const parsedNoticePeriodDays = noticePeriodDays.trim()
      ? Number.parseInt(noticePeriodDays.trim(), 10)
      : undefined;
    if (
      !useTenantRenewalDefaults &&
      parsedNoticePeriodDays !== undefined &&
      (!Number.isFinite(parsedNoticePeriodDays) || parsedNoticePeriodDays < 0)
    ) {
      setError('Notice period days must be a non-negative whole number');
      return;
    }

    const parsedRenewalTermMonths = renewalTermMonths.trim()
      ? Number.parseInt(renewalTermMonths.trim(), 10)
      : undefined;
    if (!isOngoing && !useTenantRenewalDefaults && renewalMode === 'auto') {
      if (
        parsedRenewalTermMonths === undefined ||
        !Number.isFinite(parsedRenewalTermMonths) ||
        parsedRenewalTermMonths <= 0
      ) {
        setError('Renewal term months must be a positive whole number for auto-renew contracts');
        return;
      }
    }

    try { // Add try block
      await onContractAssigned({
        startDate,
        endDate: isOngoing ? null : endDate,
        use_tenant_renewal_defaults: isOngoing ? undefined : useTenantRenewalDefaults,
        renewal_mode: isOngoing || useTenantRenewalDefaults ? undefined : renewalMode,
        notice_period_days:
          !isOngoing && !useTenantRenewalDefaults && renewalMode !== 'none'
            ? parsedNoticePeriodDays
            : undefined,
        renewal_term_months:
          !isOngoing && !useTenantRenewalDefaults && renewalMode === 'auto'
            ? parsedRenewalTermMonths
            : undefined,
      });
      handleClose(); // Close only on success
    } catch (err) { // Add catch block
      if (err instanceof Error) {
        setError(err.message); // Set error state with backend message
      } else {
        setError('An unexpected error occurred.'); // Generic fallback
      }
    }
  };

  const handleClose = () => {
    setOpen(false);
    if (onClose) {
      onClose();
    }
  };

  return (
    <>
      {triggerButton && (
        <div onClick={() => setOpen(true)}>
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open}
        onClose={handleClose}
        title={initialStartDate ? 'Edit Contract Assignment' : 'Assign Contract to Client'}
        className="max-w-md"
      >
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Display Contract Line Names if provided (likely in edit mode) */}
            {contractLineNames && contractLineNames.length > 0 && (
              <div className="mb-4 border-b pb-4">
                <h4 className="font-semibold mb-2 text-sm text-gray-700">Included Contract Lines:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                  {contractLineNames.map((contractLineName: string, index: number) => (
                    <li key={index}>{contractLineName}</li>
                  ))}
                </ul>
              </div>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div>
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            
            <SwitchWithLabel
              label="Ongoing (no end date)"
              checked={isOngoing}
              onCheckedChange={(checked) => {
                setIsOngoing(checked);
                if (checked) {
                  setEndDate(null); // Clear end date if ongoing
                }
              }}
            />
            
            {!isOngoing && (
              <>
                <div>
                  <Label htmlFor="end-date">End Date</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={endDate || ''}
                    onChange={(e) => setEndDate(e.target.value)}
                    required={!isOngoing}
                    min={startDate}
                  />
                </div>

                <div className="border rounded-md p-3 space-y-3 bg-[rgb(var(--color-surface-50))]">
                  <div>
                    <h4 className="text-sm font-semibold">Renewal Settings</h4>
                    <p className="text-xs text-[rgb(var(--color-text-500))]">
                      Set how this fixed-term assignment should be handled at renewal.
                    </p>
                  </div>

                  <SwitchWithLabel
                    label="Use tenant renewal defaults"
                    checked={useTenantRenewalDefaults}
                    onCheckedChange={setUseTenantRenewalDefaults}
                  />

                  {!useTenantRenewalDefaults && (
                    <div>
                      <Label htmlFor="client-contract-renewal-mode">Renewal Mode</Label>
                      <CustomSelect
                        id="client-contract-renewal-mode"
                        options={[
                          { value: 'manual', label: 'Manual renewal' },
                          { value: 'auto', label: 'Auto-renew' },
                          { value: 'none', label: 'Non-renewing' },
                        ]}
                        value={renewalMode}
                        onValueChange={(value: string) =>
                          setRenewalMode(value as 'none' | 'manual' | 'auto')
                        }
                        className="w-full"
                      />
                    </div>
                  )}

                  {!useTenantRenewalDefaults && renewalMode !== 'none' && (
                    <div>
                      <Label htmlFor="client-contract-notice-period-days">Notice Period (Days)</Label>
                      <Input
                        id="client-contract-notice-period-days"
                        type="number"
                        min={0}
                        step={1}
                        value={noticePeriodDays}
                        onChange={(e) => setNoticePeriodDays(e.target.value)}
                        placeholder="e.g., 30"
                      />
                    </div>
                  )}

                  {!useTenantRenewalDefaults && renewalMode === 'auto' && (
                    <div>
                      <Label htmlFor="client-contract-renewal-term-months">Renewal Term (Months)</Label>
                      <Input
                        id="client-contract-renewal-term-months"
                        type="number"
                        min={1}
                        step={1}
                        value={renewalTermMonths}
                        onChange={(e) => setRenewalTermMonths(e.target.value)}
                        placeholder="e.g., 12"
                      />
                    </div>
                  )}

                  {useTenantRenewalDefaults && (
                    <p className="text-xs text-[rgb(var(--color-text-500))]">
                      Renewal mode and notice period will follow your organization billing defaults.
                    </p>
                  )}
                </div>
              </>
            )}

            {isOngoing && (
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                Renewal settings appear for fixed-term assignments with an end date.
              </p>
            )}
            
            <DialogFooter>
              <Button
                id="cancel-contract-assignment-btn"
                type="button"
                variant="secondary"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                id="save-contract-assignment-btn"
                type="submit"
              >
                {initialStartDate ? 'Update Assignment' : 'Assign Contract'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
