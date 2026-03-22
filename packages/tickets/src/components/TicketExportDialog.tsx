'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Download, Check, FileSpreadsheet } from 'lucide-react';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { exportTicketsToCSV } from '../actions/ticketExportActions';
import type { ITicketListFilters } from '@alga-psa/types';

interface TicketExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filters: ITicketListFilters;
  totalCount: number;
  selectedTicketIds: string[];
}

type ExportStep = 'configure' | 'exporting' | 'complete';

const EXPORT_FIELDS = [
  { key: 'ticket_number', label: 'Ticket Number' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'is_closed', label: 'Is Closed' },
  { key: 'priority', label: 'Priority' },
  { key: 'board', label: 'Board' },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'client', label: 'Client' },
  { key: 'contact', label: 'Contact' },
  { key: 'assigned_to', label: 'Assigned To' },
  { key: 'assigned_team', label: 'Assigned Team' },
  { key: 'entered_by', label: 'Entered By' },
  { key: 'updated_by', label: 'Updated By' },
  { key: 'closed_by', label: 'Closed By' },
  { key: 'entered_at', label: 'Entered At' },
  { key: 'updated_at', label: 'Updated At' },
  { key: 'closed_at', label: 'Closed At' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'response_state', label: 'Response State' },
  { key: 'ticket_origin', label: 'Ticket Origin' },
  { key: 'tags', label: 'Tags' },
];

const ALL_FIELD_KEYS = EXPORT_FIELDS.map(f => f.key);

const TicketExportDialog: React.FC<TicketExportDialogProps> = ({
  isOpen,
  onClose,
  filters,
  totalCount,
  selectedTicketIds,
}) => {
  const [step, setStep] = useState<ExportStep>('configure');
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(ALL_FIELD_KEYS));
  const [exportedCount, setExportedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const exportCount = selectedTicketIds.length;
  const allSelected = selectedFields.size === EXPORT_FIELDS.length;
  const noneSelected = selectedFields.size === 0;

  const handleClose = useCallback(() => {
    if (step === 'exporting') return;
    setStep('configure');
    setSelectedFields(new Set(ALL_FIELD_KEYS));
    setExportedCount(0);
    setError(null);
    onClose();
  }, [step, onClose]);

  const toggleField = useCallback((key: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedFields(prev =>
      prev.size === EXPORT_FIELDS.length ? new Set() : new Set(ALL_FIELD_KEYS)
    );
  }, []);

  const handleExport = useCallback(async () => {
    setStep('exporting');
    setError(null);

    try {
      const orderedFields = ALL_FIELD_KEYS.filter(k => selectedFields.has(k));
      const { csv, count } = await exportTicketsToCSV(
        filters,
        orderedFields,
        selectedTicketIds,
      );

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `tickets-export-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportedCount(count);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export tickets');
      setStep('configure');
      handleError(err, 'Failed to export tickets');
    }
  }, [filters, selectedFields, selectedTicketIds]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Export Tickets"
      className="max-w-lg"
    >
      <DialogContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step 1: Configure */}
        {step === 'configure' && (
          <div>
            <Alert variant="info" className="mb-4" showIcon={false}>
              <AlertDescription className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 shrink-0" />
                <span>
                  Exporting <strong>{exportCount}</strong> selected ticket{exportCount === 1 ? '' : 's'}
                  {' '}
                  <span className="text-xs opacity-75">
                    (of {totalCount} ticket{totalCount === 1 ? '' : 's'} matching applied filters)
                  </span>
                </span>
              </AlertDescription>
            </Alert>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))]">
                  Fields to export
                </h3>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-primary-600 hover:text-primary-700 dark:text-[rgb(var(--color-primary-400))] dark:hover:text-[rgb(var(--color-primary-300))]"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 p-3">
                  {EXPORT_FIELDS.map((field) => (
                    <Checkbox
                      key={field.key}
                      id={`export-field-${field.key}`}
                      label={field.label}
                      checked={selectedFields.has(field.key)}
                      onChange={() => toggleField(field.key)}
                      size="sm"
                      containerClassName="mb-0"
                      skipRegistration
                    />
                  ))}
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-[rgb(var(--color-text-500))]">
                {selectedFields.size} of {EXPORT_FIELDS.length} fields selected
              </p>
            </div>

            <DialogFooter>
              <Button
                id="export-cancel-btn"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                id="export-tickets-btn"
                onClick={() => void handleExport()}
                disabled={exportCount === 0 || noneSelected}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export {exportCount} Ticket{exportCount === 1 ? '' : 's'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Exporting */}
        {step === 'exporting' && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-[rgb(var(--color-text-400))]">Exporting tickets...</p>
          </div>
        )}

        {/* Step 3: Complete */}
        {step === 'complete' && (
          <div className="text-center py-8">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-lg font-medium mb-2">Export Complete</h3>
            <p className="text-gray-600 dark:text-[rgb(var(--color-text-400))]">
              Successfully exported {exportedCount} ticket{exportedCount === 1 ? '' : 's'} to CSV.
            </p>
            <DialogFooter>
              <Button
                id="export-done-btn"
                onClick={handleClose}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TicketExportDialog;
