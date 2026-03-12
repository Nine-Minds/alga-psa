'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Download, FileSpreadsheet, Check } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { exportTicketsToCSV } from '../actions/ticketExportActions';
import type { ITicketListFilters } from '@alga-psa/types';

interface TicketExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filters: ITicketListFilters;
  totalCount: number;
}

type ExportStep = 'configure' | 'exporting' | 'complete';

const EXPORT_FIELDS = [
  { key: 'ticket_number', label: 'Ticket Number' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'board', label: 'Board' },
  { key: 'category', label: 'Category' },
  { key: 'client', label: 'Client' },
  { key: 'assigned_to', label: 'Assigned To' },
  { key: 'assigned_team', label: 'Assigned Team' },
  { key: 'entered_by', label: 'Entered By' },
  { key: 'entered_at', label: 'Entered At' },
  { key: 'updated_at', label: 'Updated At' },
  { key: 'closed_at', label: 'Closed At' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'response_state', label: 'Response State' },
];

const TicketExportDialog: React.FC<TicketExportDialogProps> = ({
  isOpen,
  onClose,
  filters,
  totalCount,
}) => {
  const [step, setStep] = useState<ExportStep>('configure');
  const [exportedCount, setExportedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (step === 'exporting') return;
    setStep('configure');
    setExportedCount(0);
    setError(null);
    onClose();
  }, [step, onClose]);

  const handleExport = useCallback(async () => {
    setStep('exporting');
    setError(null);

    try {
      const { csv, count } = await exportTicketsToCSV(filters);

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
  }, [filters]);

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
            <div className="text-center p-6 border-2 border-dashed border-gray-300 dark:border-[rgb(var(--color-border-200))] rounded-lg">
              <FileSpreadsheet className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600 dark:text-[rgb(var(--color-text-400))]">
                Export your tickets to a CSV file
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-[rgb(var(--color-text-500))]">
                {totalCount} ticket{totalCount === 1 ? '' : 's'} match your current filters
              </p>
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))] mb-2">
                Fields included in export
              </h3>
              <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))] max-h-48 overflow-y-auto">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3">
                  {EXPORT_FIELDS.map((field) => (
                    <div key={field.key} className="flex items-center gap-2 text-sm text-gray-600 dark:text-[rgb(var(--color-text-300))]">
                      <Check className="h-3 w-3 text-green-500 shrink-0" />
                      {field.label}
                    </div>
                  ))}
                </div>
              </div>
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
                disabled={totalCount === 0}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export {totalCount} Ticket{totalCount === 1 ? '' : 's'}
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
