import React, { useEffect, useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import type { ExternalEntityMapping } from 'server/src/lib/actions/externalMappingActions';
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

    try {
      await onSubmit({
        algaEntityId: selectedAlgaId,
        externalEntityId: selectedExternalId,
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

  return (
    <Dialog id={dialogId} isOpen={isOpen} onClose={onClose} title={dialogTitle}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor={`${module.id}-alga-select`} className="text-right">
              {module.labels.dialog.algaField}
            </Label>
            <CustomSelect
              id={`${module.id}-alga-select`}
              options={algaOptions}
              value={selectedAlgaId}
              onValueChange={(value: string) => setSelectedAlgaId(value || '')}
              placeholder={`Select ${module.labels.dialog.algaField}...`}
              disabled={isEditing}
              required={!isEditing}
              className="col-span-3"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor={`${module.id}-external-select`} className="text-right">
              {module.labels.dialog.externalField}
            </Label>
            <CustomSelect
              id={`${module.id}-external-select`}
              options={externalOptions}
              value={selectedExternalId}
              onValueChange={(value: string) => setSelectedExternalId(value || '')}
              placeholder={`Select ${module.labels.dialog.externalField}...`}
              required
              className="col-span-3"
            />
          </div>

          {context.realmId ? (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor={`${module.id}-realm-id`} className="text-right">
                {realmLabel}
              </Label>
              <Input
                id={`${module.id}-realm-id`}
                value={context.realmId}
                readOnly
                disabled
                className="col-span-3 bg-muted"
              />
            </div>
          ) : null}

          {module.metadata?.enableJsonEditor ? (
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor={`${module.id}-metadata`} className="pt-2 text-right">
                Metadata (JSON)
              </Label>
              <textarea
                id={`${module.id}-metadata`}
                value={metadataInput}
                onChange={(event) => setMetadataInput(event.target.value)}
                rows={4}
                className="col-span-3 rounded-md border p-2 text-sm"
                placeholder="Optional metadata as JSON"
              />
            </div>
          ) : null}

          {error ? <p className="text-center text-sm text-red-600">{error}</p> : null}

          <DialogFooter>
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
