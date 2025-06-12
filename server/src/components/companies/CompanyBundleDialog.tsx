'use client'

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel'; // Import SwitchWithLabel
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

interface CompanyBundleDialogProps {
  onBundleAssigned: (startDate: string, endDate: string | null) => void;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  isOpen?: boolean;
  initialStartDate?: string;
  initialEndDate?: string | null;
  planNames?: string[]; // Added optional prop for plan names
}

export function CompanyBundleDialog({ 
  onBundleAssigned, 
  onClose, 
  triggerButton, 
  isOpen = false,
  initialStartDate,
  initialEndDate,
  planNames // Destructure the new prop
}: CompanyBundleDialogProps) {
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
      await onBundleAssigned(startDate, isOngoing ? null : endDate); // Await the backend call
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
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleClose();
        }
        setOpen(isOpen);
      }}
    >
      {triggerButton && (
        <Dialog.Trigger asChild>
          {triggerButton}
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[400px]">
          <Dialog.Title className="text-lg font-medium text-gray-900 mb-2">
            {initialStartDate ? 'Edit Bundle Assignment' : 'Assign Bundle to Company'}
          </Dialog.Title>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Display Plan Names if provided (likely in edit mode) - Moved inside form */}
            {planNames && planNames.length > 0 && (
              <div className="mb-4 border-b pb-4">
                <h4 className="font-semibold mb-2 text-sm text-gray-700">Included Plans:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                  {planNames.map((planName: string, index: number) => ( // Added explicit types
                    <li key={index}>{planName}</li>
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
            
            <div className="flex justify-end gap-2 pt-4">
              <Button
                id="cancel-bundle-assignment-btn"
                type="button"
                variant="secondary"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                id="save-bundle-assignment-btn"
                type="submit"
              >
                {initialStartDate ? 'Update Assignment' : 'Assign Bundle'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}