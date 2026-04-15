'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from './Dialog';
import { Input } from './Input';
import { Button } from './Button';
import { Label } from './Label';
import { Checkbox } from './Checkbox';
import ColorPicker, { SOLID_COLORS } from './ColorPicker';
import { Circle } from 'lucide-react';
import type { ItemType, IStatus } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { handleError } from '../lib/errorHandling';
import { useTranslation } from 'react-i18next';

export interface QuickAddStatusProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusCreated: (status: IStatus) => void;
  statusType: ItemType;
  createStatus: (args: {
    name: string;
    statusType: ItemType;
    isClosed: boolean;
    color: string;
  }) => Promise<IStatus>;
  existingStatuses?: Array<{ name: string }>;
  /** Optional trigger element to open the dialog */
  trigger?: React.ReactNode;
  /** Whether to show the color picker (default: true) */
  showColorPicker?: boolean;
}

/**
 * Reusable component for quickly creating a new status.
 * Can be used in wizards, dialogs, and anywhere quick status creation is needed.
 */
export function QuickAddStatus({
  open,
  onOpenChange,
  onStatusCreated,
  statusType,
  createStatus,
  existingStatuses = [],
  trigger,
  showColorPicker = true,
}: QuickAddStatusProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [statusName, setStatusName] = useState('');
  const [statusColor, setStatusColor] = useState(SOLID_COLORS[0]);
  const [isClosed, setIsClosed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setStatusName('');
      // Pick a random color from the solid color palette
      const randomIndex = Math.floor(Math.random() * SOLID_COLORS.length);
      setStatusColor(SOLID_COLORS[randomIndex]);
      setIsClosed(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    const trimmedName = statusName.trim();

    if (!trimmedName) {
      setError(t('quickAddStatus.nameRequired', 'Status name is required'));
      return;
    }

    // Check for duplicate names
    const isDuplicate = existingStatuses.some(
      s => s.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicate) {
      setError(t('quickAddStatus.duplicateName', 'A status with this name already exists'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const newStatus = await createStatus({
        name: trimmedName,
        statusType,
        isClosed,
        color: statusColor,
      });

      toast.success(t('quickAddStatus.createdSuccess', 'Status "{{name}}" created successfully', { name: trimmedName }));
      onStatusCreated(newStatus);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('quickAddStatus.createFailed', 'Failed to create status');
      setError(message);
      handleError(err, t('quickAddStatus.createFailed', 'Failed to create status'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={t('quickAddStatus.title', 'Create New Status')}
      className="max-w-md"
      id="quick-add-status-dialog"
    >
      <DialogContent>
        <div id="quick-add-status-form">
          <div className="space-y-4">
            {/* Status Name */}
            <div>
              <Label htmlFor="quick-add-status-name" className="block text-sm font-medium text-gray-700 mb-1">
                {t('quickAddStatus.statusName', 'Status Name')} *
              </Label>
              <Input
                id="quick-add-status-name"
                value={statusName}
                onChange={(e) => {
                  setStatusName(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={t('quickAddStatus.namePlaceholder', 'e.g., In Progress, Review, Done')}
                autoFocus
                disabled={isSubmitting}
                className={error ? 'border-red-500' : ''}
              />
              {error && (
                <p className="text-sm text-red-600 mt-1">{error}</p>
              )}
            </div>

            {/* Color Picker */}
            {showColorPicker && (
            <div>
              <Label className="block text-sm font-medium text-gray-700 mb-2">
                {t('quickAddStatus.statusColor', 'Status Color')}
              </Label>
              <div className="flex items-center gap-3">
                <ColorPicker
                  currentBackgroundColor={statusColor}
                  currentTextColor={null}
                  onSave={(backgroundColor) => setStatusColor(backgroundColor || SOLID_COLORS[0])}
                  showTextColor={false}
                  previewType="circle"
                  colorMode="solid"
                  trigger={
                    <button
                      type="button"
                      className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-gray-50"
                      title="Click to change color"
                    >
                      <Circle
                        className="w-5 h-5"
                        fill={statusColor}
                        stroke={statusColor}
                      />
                      <span className="text-sm text-gray-600">{t('quickAddStatus.changeColor', 'Change color')}</span>
                    </button>
                  }
                />
                <span className="text-xs text-gray-500">{statusColor}</span>
              </div>
            </div>
            )}

            {/* Is Closed Checkbox */}
            <div className="flex items-start gap-2">
              <Checkbox
                id="quick-add-status-is-closed"
                checked={isClosed}
                onChange={(e) => setIsClosed((e.target as HTMLInputElement).checked)}
                disabled={isSubmitting}
              />
              <div>
                <Label htmlFor="quick-add-status-is-closed" className="text-sm font-medium text-gray-700 cursor-pointer">
                  {t('quickAddStatus.markClosed', 'Mark as closed status')}
                </Label>
                <p className="text-xs text-gray-500 mt-0.5">
                  {t('quickAddStatus.markClosedDescription', 'Tasks in closed statuses are considered complete')}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              id="quick-add-status-cancel"
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button
              id="quick-add-status-submit"
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !statusName.trim()}
            >
              {isSubmitting ? t('quickAddStatus.creating', 'Creating...') : t('quickAddStatus.createButton', 'Create Status')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default QuickAddStatus;
