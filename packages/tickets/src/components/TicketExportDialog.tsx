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
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TicketExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filters: ITicketListFilters;
  totalCount: number;
  selectedTicketIds: string[];
}

type ExportStep = 'configure' | 'exporting' | 'complete';

const EXPORT_FIELDS = [
  { key: 'ticket_number', labelKey: 'fields.ticketNumber', fallback: 'Ticket Number' },
  { key: 'title', labelKey: 'fields.title', fallback: 'Title' },
  { key: 'status', labelKey: 'fields.status', fallback: 'Status' },
  { key: 'is_closed', labelKey: 'fields.isClosed', fallback: 'Is Closed' },
  { key: 'priority', labelKey: 'fields.priority', fallback: 'Priority' },
  { key: 'board', labelKey: 'fields.board', fallback: 'Board' },
  { key: 'category', labelKey: 'fields.category', fallback: 'Category' },
  { key: 'subcategory', labelKey: 'fields.subcategory', fallback: 'Subcategory' },
  { key: 'client', labelKey: 'fields.client', fallback: 'Client' },
  { key: 'contact', labelKey: 'properties.contact', fallback: 'Contact' },
  { key: 'assigned_to', labelKey: 'fields.assignedTo', fallback: 'Assigned To' },
  { key: 'assigned_team', labelKey: 'fields.assignedTeam', fallback: 'Assigned Team' },
  { key: 'entered_by', labelKey: 'fields.enteredBy', fallback: 'Entered By' },
  { key: 'updated_by', labelKey: 'fields.updatedBy', fallback: 'Updated By' },
  { key: 'closed_by', labelKey: 'fields.closedBy', fallback: 'Closed By' },
  { key: 'entered_at', labelKey: 'fields.enteredAt', fallback: 'Entered At' },
  { key: 'updated_at', labelKey: 'fields.updatedAt', fallback: 'Updated At' },
  { key: 'closed_at', labelKey: 'fields.closedAt', fallback: 'Closed At' },
  { key: 'due_date', labelKey: 'fields.dueDate', fallback: 'Due Date' },
  { key: 'response_state', labelKey: 'fields.responseState', fallback: 'Response State' },
  { key: 'ticket_origin', labelKey: 'fields.ticketOrigin', fallback: 'Ticket Origin' },
  { key: 'tags', labelKey: 'settings.display.columns.tags', fallback: 'Tags' },
];

const ALL_FIELD_KEYS = EXPORT_FIELDS.map(f => f.key);

const TicketExportDialog: React.FC<TicketExportDialogProps> = ({
  isOpen,
  onClose,
  filters,
  totalCount,
  selectedTicketIds,
}) => {
  const { t } = useTranslation('features/tickets');
  const [step, setStep] = useState<ExportStep>('configure');
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(ALL_FIELD_KEYS));
  const [exportedCount, setExportedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const exportCount = selectedTicketIds.length;
  const allSelected = selectedFields.size === EXPORT_FIELDS.length;
  const noneSelected = selectedFields.size === 0;
  const selectedTicketsSummary = t('export.selectedTicketsSummary', 'Exporting {{count}} selected ticket', {
    count: exportCount,
  });
  const selectedSummaryCount = String(exportCount);
  const selectedSummaryCountIndex = selectedTicketsSummary.indexOf(selectedSummaryCount);

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
      setError(err instanceof Error ? err.message : t('export.failed', 'Failed to export tickets'));
      setStep('configure');
      handleError(err, t('export.failed', 'Failed to export tickets'));
    }
  }, [filters, selectedFields, selectedTicketIds, t]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t('export.title', 'Export Tickets')}
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
                  {selectedSummaryCountIndex >= 0 ? (
                    <>
                      {selectedTicketsSummary.slice(0, selectedSummaryCountIndex)}
                      <strong>{selectedSummaryCount}</strong>
                      {selectedTicketsSummary.slice(selectedSummaryCountIndex + selectedSummaryCount.length)}
                    </>
                  ) : (
                    selectedTicketsSummary
                  )}
                  {' '}
                  <span className="text-xs opacity-75">
                    {t('export.appliedFiltersSummary', '(of {{count}} ticket matching applied filters)', {
                      count: totalCount,
                    })}
                  </span>
                </span>
              </AlertDescription>
            </Alert>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))]">
                  {t('export.fieldsTitle', 'Fields to export')}
                </h3>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-primary-600 hover:text-primary-700 dark:text-[rgb(var(--color-primary-400))] dark:hover:text-[rgb(var(--color-primary-300))]"
                >
                  {allSelected
                    ? t('export.deselectAll', 'Deselect all')
                    : t('export.selectAll', 'Select all')}
                </button>
              </div>
              <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 p-3">
                  {EXPORT_FIELDS.map((field) => (
                    <Checkbox
                      key={field.key}
                      id={`export-field-${field.key}`}
                      label={t(field.labelKey, field.fallback)}
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
                {t('export.selectedCount', '{{selected}} of {{total}} fields selected', {
                  selected: selectedFields.size,
                  total: EXPORT_FIELDS.length,
                })}
              </p>
            </div>

            <DialogFooter>
              <Button
                id="export-cancel-btn"
                variant="outline"
                onClick={handleClose}
              >
                {t('actions.cancel', 'Cancel')}
              </Button>
              <Button
                id="export-tickets-btn"
                onClick={() => void handleExport()}
                disabled={exportCount === 0 || noneSelected}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                {t('export.confirm', 'Export {{count}} Ticket', { count: exportCount })}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Exporting */}
        {step === 'exporting' && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-[rgb(var(--color-text-400))]">{t('export.exporting', 'Exporting tickets...')}</p>
          </div>
        )}

        {/* Step 3: Complete */}
        {step === 'complete' && (
          <div className="text-center py-8">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-lg font-medium mb-2">{t('export.completeTitle', 'Export Complete')}</h3>
            <p className="text-gray-600 dark:text-[rgb(var(--color-text-400))]">
              {t('export.completeMessage', 'Successfully exported {{count}} ticket to CSV.', {
                count: exportedCount,
              })}
            </p>
            <DialogFooter>
              <Button
                id="export-done-btn"
                onClick={handleClose}
              >
                {t('export.done', 'Done')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TicketExportDialog;
