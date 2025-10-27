// server/src/components/integrations/qbo/QboMappingFormDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect'; // Correct: Default import
import { Input } from 'server/src/components/ui/Input'; // For potential metadata
import { createExternalEntityMapping, updateExternalEntityMapping } from '@product/actions/externalMappingActions';
// Removed import for placeholder AlgaService type
import { QboItem } from '@product/actions/integrations/qboActions'; // Import type
// Import DisplayMapping type (assuming definition is compatible/exported from Item table or shared types)
// Ideally, this should be in a shared types file.
import { DisplayMapping } from './QboItemMappingTable'; // Adjust path if needed

// Assuming a generic structure for external entities for the select
interface ExternalEntityOption {
  id: string;
  name: string;
}

interface QboMappingFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void; // Callback after successful save/update
  existingMapping: DisplayMapping | null; // Use the imported type
  // Removed tenantId prop
  realmId: string;
  algaEntityType: string; // e.g., 'service'
  externalEntityType: string; // e.g., 'Item'
  algaEntities: ExternalEntityOption[]; // e.g., AlgaService[]
  externalEntities: ExternalEntityOption[]; // e.g., QboItem[]
  algaEntityLabel: string; // e.g., 'Alga Service'
  externalEntityLabel: string; // e.g., 'QuickBooks Item'
  dialogId: string; // For automation/testing
}

export function QboMappingFormDialog({
  isOpen,
  onClose,
  onSave,
  existingMapping,
  // tenantId, // Removed from props
  realmId,
  algaEntityType,
  externalEntityType,
  algaEntities,
  externalEntities,
  algaEntityLabel,
  externalEntityLabel,
  dialogId,
}: QboMappingFormDialogProps) {
  const [selectedAlgaEntityId, setSelectedAlgaEntityId] = useState<string>('');
  const [selectedExternalEntityId, setSelectedExternalEntityId] = useState<string>('');
  const [metadataInput, setMetadataInput] = useState<string>(''); // Example for metadata
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!existingMapping;

  useEffect(() => {
    if (existingMapping) {
      setSelectedAlgaEntityId(existingMapping.alga_entity_id || '');
      setSelectedExternalEntityId(existingMapping.external_entity_id || '');
      setMetadataInput(existingMapping.metadata ? JSON.stringify(existingMapping.metadata, null, 2) : '');
    } else {
      // Reset form for new mapping
      setSelectedAlgaEntityId('');
      setSelectedExternalEntityId('');
      setMetadataInput('');
    }
    setError(null); // Clear error when dialog opens or mapping changes
  }, [existingMapping, isOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    let parsedMetadata: object | null = null;
    if (metadataInput) {
      try {
        parsedMetadata = JSON.parse(metadataInput);
      } catch (e) {
        setError('Invalid JSON format for metadata.');
        setIsSaving(false);
        return;
      }
    }

    try {
      if (isEditing) {
        // Update existing mapping
        await updateExternalEntityMapping(existingMapping.id, {
          external_entity_id: selectedExternalEntityId,
          metadata: parsedMetadata,
          // Add other updatable fields like sync_status if needed
        });
      } else {
        // Create new mapping
        await createExternalEntityMapping({
          integration_type: 'quickbooks_online', // Hardcoded for QBO
          alga_entity_type: algaEntityType,
          alga_entity_id: selectedAlgaEntityId,
          external_entity_id: selectedExternalEntityId,
          external_realm_id: realmId,
          metadata: parsedMetadata,
          sync_status: 'manual_link', // Indicate it was manually created/linked
        });
      }
      onSave(); // Trigger refresh in parent table
      onClose(); // Close dialog on success
    } catch (err: any) {
      console.error('Failed to save mapping:', err);
      setError(`Failed to save mapping: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Prepare options for selects
  const algaOptions = algaEntities.map(e => ({ value: e.id, label: e.name }));
  const externalOptions = externalEntities.map(e => ({ value: e.id, label: e.name }));

  return (
    // Pass isOpen, onClose, and id directly to the Dialog wrapper
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose} 
      id={dialogId} 
      title={isEditing ? `Edit ${externalEntityLabel} Mapping` : `Add New ${externalEntityLabel} Mapping`}
    >
      {/* DialogContent does not take an id */}
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Alga Entity Select */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor={`${dialogId}-alga-select`} className="text-right">
              {algaEntityLabel}
            </Label>
            <CustomSelect
              id={`${dialogId}-alga-select`} // Unique ID
              options={algaOptions}
              value={selectedAlgaEntityId}
              onValueChange={(value: string) => setSelectedAlgaEntityId(value || '')} // Correct prop name and add type
              placeholder={`Select ${algaEntityLabel}...`}
              disabled={isEditing} // Don't allow changing Alga entity when editing
              required={!isEditing} // Required only when creating
              className="col-span-3"
            />
          </div>

          {/* External Entity Select */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor={`${dialogId}-external-select`} className="text-right">
              {externalEntityLabel}
            </Label>
            <CustomSelect
              id={`${dialogId}-external-select`} // Unique ID
              options={externalOptions}
              value={selectedExternalEntityId}
              onValueChange={(value: string) => setSelectedExternalEntityId(value || '')} // Correct prop name and add type
              placeholder={`Select ${externalEntityLabel}...`}
              required
              className="col-span-3"
            />
          </div>

          {/* Realm ID (Read Only) */}
           <div className="grid grid-cols-4 items-center gap-4">
             <Label htmlFor={`${dialogId}-realm-id`} className="text-right">
               Realm ID
             </Label>
             <Input
               id={`${dialogId}-realm-id`}
               value={realmId}
               readOnly
               disabled
               className="col-span-3 bg-muted"
             />
           </div>

          {/* Optional Metadata Input */}
          {/* <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor={`${dialogId}-metadata`} className="text-right">
              Metadata (JSON)
            </Label>
            <textarea
              id={`${dialogId}-metadata`}
              value={metadataInput}
              onChange={(e) => setMetadataInput(e.target.value)}
              placeholder='Enter valid JSON or leave blank'
              rows={3}
              className="col-span-3 p-2 border rounded-md text-sm"
            />
          </div> */}

          {error && <p className="text-sm text-red-600 text-center pt-2">{error}</p>}

          <DialogFooter>
             {/* Use standard Button with onClick={onClose} for cancel */}
             <Button type="button" variant="outline" onClick={onClose} id={`${dialogId}-cancel-button`}>
               Cancel
             </Button>
            <Button type="submit" disabled={isSaving} id={`${dialogId}-save-button`}>
              {isSaving ? 'Saving...' : 'Save Mapping'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}