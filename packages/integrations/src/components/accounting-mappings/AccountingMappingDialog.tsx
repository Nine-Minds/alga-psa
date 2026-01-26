import React, { useEffect, useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import type { ExternalEntityMapping } from '../../actions/externalMappingActions';
import type {
  AccountingMappingContext,
  AccountingMappingEntityOption,
  AccountingMappingModule
} from './types';

type DisplayMapping = ExternalEntityMapping & {
  algaName?: string;
  externalName?: string;
};

type AccountingMappingDialogProps = {
  module: AccountingMappingModule;
  context: AccountingMappingContext;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: {
    algaEntityId: string;
    externalEntityId: string;
    metadata?: Record<string, unknown> | null;
    mappingId?: string;
  }) => Promise<void>;
  existingMapping?: DisplayMapping | null;
  algaEntities: AccountingMappingEntityOption[];
  externalEntities: AccountingMappingEntityOption[];
  realmLabel?: string;
};

export function AccountingMappingDialog({
  module,
  context,
  isOpen,
  onClose,
  onSubmit,
  existingMapping,
  algaEntities,
  externalEntities,
  realmLabel = 'Realm ID'
}: AccountingMappingDialogProps) {
  const dialogId = module.elements?.dialog ?? `${module.id}-mapping-dialog`;

  const isEditing = Boolean(existingMapping);
  const [selectedAlgaId, setSelectedAlgaId] = useState<string>('');
  const [selectedExternalId, setSelectedExternalId] = useState<string>('');
  const [metadataInput, setMetadataInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (existingMapping) {
      setSelectedAlgaId(existingMapping.alga_entity_id ?? '');
      setSelectedExternalId(existingMapping.external_entity_id ?? '');
      if (module.metadata?.enableJsonEditor) {
        setMetadataInput(
          existingMapping.metadata ? JSON.stringify(existingMapping.metadata, null, 2) : ''
        );
      } else {
        setMetadataInput('');
      }
    } else {
      setSelectedAlgaId('');
      setSelectedExternalId('');
      setMetadataInput('');
    }
    setError(null);
    setIsSaving(false);
  }, [isOpen, existingMapping, module.metadata]);

  const dialogTitle = useMemo(
    () =>
      isEditing
        ? module.labels.dialog.editTitle
        : module.labels.dialog.addTitle,
    [isEditing, module.labels.dialog]
  );

  const cancelButtonId = `${dialogId}-cancel-button`;
  const saveButtonId = `${dialogId}-save-button`;

  const algaOptions = useMemo(
    () => algaEntities.map((entity) => ({ value: entity.id, label: entity.name })),
    [algaEntities]
  );

  const externalOptions = useMemo(
    () => externalEntities.map((entity) => ({ value: entity.id, label: entity.name })),
    [externalEntities]
  );

  const hasExternalOptions = externalOptions.length > 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    let parsedMetadata: Record<string, unknown> | null = null;
    if (module.metadata?.enableJsonEditor && metadataInput.trim()) {
      try {
        parsedMetadata = JSON.parse(metadataInput);
      } catch (parseError) {
        setError('Invalid JSON format for metadata.');
        setIsSaving(false);
        return;
      }
    }

    // Validate Alga entity selection
    if (!selectedAlgaId) {
      setError(`Please select ${module.labels.dialog.algaField.toLowerCase()}.`);
      setIsSaving(false);
      return;
    }

    const trimmedExternalId = selectedExternalId.trim();
    if (!trimmedExternalId) {
      setError(`Please ${hasExternalOptions ? 'select' : 'enter'} ${module.labels.dialog.externalField.toLowerCase()}.`);
      setIsSaving(false);
      return;
    }

    try {
      await onSubmit({
        algaEntityId: selectedAlgaId,
        externalEntityId: trimmedExternalId,
        metadata: parsedMetadata,
        mappingId: existingMapping?.id
      });
      onClose();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Failed to save mapping.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const renderExternalFieldHelpText = () => {
    // Show module-specific help text if available
    if (module.labels.dialog.helpText) {
      return (
        <p className="text-xs text-muted-foreground">
          {module.labels.dialog.helpText}
        </p>
      );
    }
    // Fallback for manual entry when no catalog data
    if (!hasExternalOptions) {
      return (
        <p className="text-xs text-muted-foreground">
          Enter the identifier exactly as it appears in your accounting system.
        </p>
      );
    }
    return null;
  };

  return (
    <Dialog id={dialogId} isOpen={isOpen} onClose={onClose} title={dialogTitle}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor={`${module.id}-alga-select`} className="text-sm font-medium text-foreground">
              {module.labels.dialog.algaField}
            </Label>
            <CustomSelect
              id={`${module.id}-alga-select`}
              options={algaOptions}
              value={selectedAlgaId}
              onValueChange={(value: string) => setSelectedAlgaId(value || '')}
              placeholder={`Select ${module.labels.dialog.algaField}...`}
              required
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${module.id}-external-select`} className="text-sm font-medium text-foreground">
              {module.labels.dialog.externalField}
            </Label>
            {hasExternalOptions ? (
              <CustomSelect
                id={`${module.id}-external-select`}
                options={externalOptions}
                value={selectedExternalId}
                onValueChange={(value: string) => setSelectedExternalId(value || '')}
                placeholder={`Select ${module.labels.dialog.externalField}...`}
                required
                className="w-full"
              />
            ) : (
              <Input
                id={`${module.id}-external-manual-input`}
                value={selectedExternalId}
                onChange={(event) => setSelectedExternalId(event.target.value)}
                placeholder={`Enter ${module.labels.dialog.externalField}...`}
                className="w-full"
                required
              />
            )}
            {renderExternalFieldHelpText()}
          </div>

          {context.realmId || context.realmDisplayValue ? (
            <div className="space-y-2">
              <Label htmlFor={`${module.id}-realm-id`} className="text-sm font-medium text-foreground">
                {realmLabel}
              </Label>
              <Input
                id={`${module.id}-realm-id`}
                value={context.realmDisplayValue ?? context.realmId ?? ''}
                readOnly
                disabled
                className="w-full bg-muted text-sm"
              />
            </div>
          ) : null}

          {module.metadata?.enableJsonEditor ? (
            <div className="space-y-2">
              <Label htmlFor={`${module.id}-metadata`} className="text-sm font-medium text-foreground">
                Metadata (JSON)
              </Label>
              <TextArea
                id={`${module.id}-metadata`}
                value={metadataInput}
                onChange={(event) => setMetadataInput(event.target.value)}
                placeholder="Optional metadata as JSON"
                className="max-w-none font-mono text-xs leading-5"
              />
            </div>
          ) : null}

          {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <DialogFooter className="flex items-center justify-end gap-3">
            <Button id={cancelButtonId} type="button" variant="outline" onClick={onClose}>
              {module.labels.deleteConfirmation.cancelLabel ?? 'Cancel'}
            </Button>
            <Button id={saveButtonId} type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save Mapping'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
