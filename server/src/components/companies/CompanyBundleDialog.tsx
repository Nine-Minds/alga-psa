'use client'

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

interface CompanyBundleDialogProps {
  onBundleAssigned: (startDate: string, endDate: string | null) => void;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
  isOpen?: boolean;
  initialStartDate?: string;
  initialEndDate?: string | null;
}

export function CompanyBundleDialog({ 
  onBundleAssigned, 
  onClose, 
  triggerButton, 
  isOpen = false,
  initialStartDate,
  initialEndDate
}: CompanyBundleDialogProps) {
  const [open, setOpen] = useState(isOpen);
  const [startDate, setStartDate] = useState<string>(
    initialStartDate || new Date().toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState<string | null>(initialEndDate || null);
  const [isOngoing, setIsOngoing] = useState<boolean>(!initialEndDate);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(isOpen);
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
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
    
    onBundleAssigned(startDate, isOngoing ? null : endDate);
    handleClose();
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
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
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
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-ongoing"
                checked={isOngoing}
                onChange={(checked) => {
                  setIsOngoing(!!checked);
                  if (checked) {
                    setEndDate(null);
                  }
                }}
              />
              <Label htmlFor="is-ongoing" className="cursor-pointer">Ongoing (no end date)</Label>
            </div>
            
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