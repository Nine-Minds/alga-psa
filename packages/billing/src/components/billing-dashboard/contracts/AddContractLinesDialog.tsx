'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { copyPresetToContractLine } from '@alga-psa/billing/actions/contractLinePresetActions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { ContractLinePresetPicker } from './ContractLinePresetPicker';
import { useContractLinePresetSelection } from './useContractLinePresetSelection';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface AddContractLinesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contractId: string;
  onAdd: () => Promise<void>;
  currencyCode: string;
}

export const AddContractLinesDialog: React.FC<AddContractLinesDialogProps> = ({
  isOpen,
  onClose,
  contractId,
  onAdd,
  currencyCode,
}) => {
  const { t } = useTranslation('msp/contracts');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetSelection = useContractLinePresetSelection({
    onActionError: setError,
    onLoadError: () => setError(t('addLines.errors.failedToLoadPresets', {
      defaultValue: 'Failed to load contract line presets.',
    })),
    onDetailsError: () => setError(t('addLines.errors.failedToLoadPresetDetails', {
      defaultValue: 'Failed to load preset details.',
    })),
  });
  const { selectedPresetIds, buildPresetOverrides, reset: resetPresetSelection } = presetSelection;

  // Load contract line presets when dialog opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      void presetSelection.loadPresets();
    } else {
      // Reset state when dialog closes
      resetPresetSelection();
      setError(null);
    }
  }, [isOpen]);

  const handleAdd = async () => {
    if (selectedPresetIds.size === 0) return;

    setIsAdding(true);
    setError(null);
    try {
      // Add each selected preset to the contract
      const results = await Promise.all(
        Array.from(selectedPresetIds).map(presetId =>
          copyPresetToContractLine(contractId, presetId, buildPresetOverrides(presetId))
        )
      );
      const expectedError = results.find(isReturnedActionError);
      if (expectedError) {
        setError(getErrorMessage(expectedError));
        return;
      }

      await onAdd();
      onClose();
    } catch (error) {
      console.error('Error adding contract line presets:', error);
      setError(t('addLines.errors.failedToAddPresets', {
        defaultValue: 'Failed to add selected presets.',
      }));
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('addLines.title', { defaultValue: 'Add Contract Lines from Presets' })}
      className="max-w-4xl"
      footer={(
        <div className="flex justify-end space-x-2">
          <Button
            id="cancel-add-contract-lines"
            variant="outline"
            onClick={onClose}
            disabled={isAdding}
          >
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="confirm-add-contract-lines"
            onClick={handleAdd}
            disabled={selectedPresetIds.size === 0 || isAdding}
          >
            {isAdding
              ? t('addLines.actions.adding', { defaultValue: 'Adding...' })
              : selectedPresetIds.size === 1
              ? t('addLines.actions.addSingle', { defaultValue: 'Add ({{count}}) Preset', count: selectedPresetIds.size })
              : t('addLines.actions.addPlural', { defaultValue: 'Add ({{count}}) Presets', count: selectedPresetIds.size })}
          </Button>
        </div>
      )}
    >
      <DialogContent className="flex flex-col">
        <div className="space-y-4 flex flex-col h-full">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <ContractLinePresetPicker
            selection={presetSelection}
            currencyCode={currencyCode}
            typeFilterId="preset-type-filter"
            resetFiltersId="clear-contract-line-filters"
            filtersClassName="flex flex-wrap items-center gap-2 shrink-0"
            listClassName="flex-1 overflow-y-auto border rounded-md p-2 space-y-1 max-h-[50vh]"
            labels={{
              searchPlaceholder: t('addLines.filters.searchPlaceholder', { defaultValue: 'Search presets...' }),
              noneAvailable: t('addLines.empty.noneAvailable', {
                defaultValue: 'No contract line presets available.',
              }),
              noMatches: t('addLines.empty.noMatches', { defaultValue: 'No presets match your search.' }),
            }}
          />

          {/* Selected count */}
          {selectedPresetIds.size > 0 && (
            <div className="text-sm text-blue-600 font-medium">
              {selectedPresetIds.size === 1
                ? t('addLines.selection.selectedSingle', {
                  defaultValue: '{{count}} preset selected',
                  count: selectedPresetIds.size,
                })
                : t('addLines.selection.selectedPlural', {
                  defaultValue: '{{count}} presets selected',
                  count: selectedPresetIds.size,
                })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
