'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { DatePicker } from 'server/src/components/ui/DatePicker';import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel'; // Import SwitchWithLabel
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

interface ClientContractDialogProps {
  onContractAssigned: (startDate: string, endDate: string | null) => void;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  isOpen?: boolean;
  initialStartDate?: string;
  initialEndDate?: string | null;
  contractLineNames?: string[];
}

export function ClientContractDialog({
  onContractAssigned,
  onClose,
  triggerButton,
  isOpen = false,
  initialStartDate,
  initialEndDate,
  contractLineNames
}: ClientContractDialogProps) {
  const [open, setOpen] = useState(isOpen);
  // Safely initialize startDate: check if initialStartDate is a non-empty string
  const [startDate, setStartDate] = useState<string>(() => {
    const dateStr = typeof initialStartDate === 'string' && initialStartDate ? initialStartDate.split('T')[0] : null;
    return dateStr || new Date().toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string | null>(initialEndDate || null);
  // Safely initialize isOngoing: check if initialEndDate is a non-empty string
  const [isOngoing, setIsOngoing] = useState<boolean>(!(typeof initialEndDate === 'string' && initialEndDate));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(isOpen);
  }, [isOpen]);

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

    try { // Add try block
      await onContractAssigned(startDate, isOngoing ? null : endDate); // Await the backend call
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