'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { IAssetCustodyDetail } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  handOffCustody,
  moveCustody,
  openAssetCustody,
  receiveBackCustody,
  returnCustodyToClient,
  shipCustody,
  updateCustody,
} from '../../actions/assetCustodyActions';
import { custodyOutcome, useCustodyLocations, useCustodyUsers } from './custodyClient';
import {
  CUSTODY_NOTE_MAX,
  CustodyDetailFields,
  CustodyPlaceFields,
  cleanAccessories,
  emptyCustodyDetails,
  type CustodyDetailsValue,
} from './CustodyFields';

/**
 * One small dialog per custody step (design D8). Each writes one event, or one `custody_updated` history
 * row for Edit details. A refusal shows the server's own message and leaves the dialog open.
 */

export type CustodyDialogKind = 'move' | 'handOff' | 'ship' | 'receiveBack' | 'return' | 'edit';

interface StepDialogProps {
  isOpen: boolean;
  onClose: () => void;
  custody: IAssetCustodyDetail;
  /** Called after a successful write; the host revalidates card, timeline and lists. */
  onDone: () => void;
}

export function DialogShell({
  id,
  title,
  description,
  submitLabel,
  isOpen,
  onClose,
  onSubmit,
  canSubmit = true,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  submitLabel: string;
  isOpen: boolean;
  onClose: () => void;
  /** Resolve to an error message to keep the dialog open, or null on success. */
  onSubmit: () => Promise<string | null>;
  canSubmit?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('msp/assets');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setBusy(false);
    }
  }, [isOpen]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit();
      if (message) setError(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('custody.errors.generic', { defaultValue: 'Something went wrong.' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      id={id}
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      className="max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button id={`${id}-cancel`} type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('custody.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id={`${id}-submit`} type="button" onClick={submit} disabled={busy || !canSubmit}>
            {busy ? t('custody.actions.saving', { defaultValue: 'Saving...' }) : submitLabel}
          </Button>
        </div>
      }
    >
      <DialogContent>
        <div className="space-y-4">
          {description ? <p className="text-sm text-[rgb(var(--color-text-600))]">{description}</p> : null}
          {children}
          {error ? (
            <p role="alert" className="text-sm text-[rgb(var(--badge-danger-text))]">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NoteField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('msp/assets');
  return (
    <div>
      <Label htmlFor={id}>{t('custody.fields.note', { defaultValue: 'Note (optional)' })}</Label>
      <TextArea id={id} rows={2} maxLength={CUSTODY_NOTE_MAX} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Folds a write result into "error message or null", and signals success. */
export async function finish(result: unknown, onDone: () => void, onClose: () => void): Promise<string | null> {
  const outcome = custodyOutcome<unknown>(result);
  if (!outcome.ok) return outcome.message;
  onDone();
  onClose();
  return null;
}

export function MoveCustodyDialog({ isOpen, onClose, custody, onDone }: StepDialogProps) {
  const { t } = useTranslation('msp/assets');
  const { locations } = useCustodyLocations(isOpen);
  const [locationId, setLocationId] = useState('');
  const [bin, setBin] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLocationId(custody.location_id ?? '');
    setBin(custody.bin ?? '');
    setNote('');
  }, [isOpen, custody.custody_id, custody.location_id, custody.bin]);

  const changed = locationId !== (custody.location_id ?? '') || bin.trim() !== (custody.bin ?? '');

  return (
    <DialogShell
      id={`custody-move-${custody.custody_id}`}
      title={t('custody.move.title', { defaultValue: 'Move equipment' })}
      submitLabel={t('custody.move.submit', { defaultValue: 'Move' })}
      isOpen={isOpen}
      onClose={onClose}
      canSubmit={changed}
      onSubmit={async () =>
        finish(
          await moveCustody(custody.custody_id, {
            location_id: locationId || undefined,
            bin: bin.trim() || null,
            note: note.trim() || undefined,
          }),
          onDone,
          onClose
        )
      }
    >
      <CustodyPlaceFields
        idPrefix={`custody-move-${custody.custody_id}`}
        locations={locations}
        locationId={locationId}
        bin={bin}
        onLocationChange={setLocationId}
        onBinChange={setBin}
        locationLabel={t('custody.move.toLocation', { defaultValue: 'Move to' })}
      />
      <NoteField id={`custody-move-${custody.custody_id}-note`} value={note} onChange={setNote} />
    </DialogShell>
  );
}

export function HolderPicker({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const users = useCustodyUsers();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <UserPicker
        id={id}
        users={users}
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        buttonWidth="full"
        className="w-full"
        modal
      />
    </div>
  );
}

export function HandOffCustodyDialog({ isOpen, onClose, custody, onDone }: StepDialogProps) {
  const { t } = useTranslation('msp/assets');
  const [holder, setHolder] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (isOpen) {
      setHolder('');
      setNote('');
    }
  }, [isOpen, custody.custody_id]);

  return (
    <DialogShell
      id={`custody-handoff-${custody.custody_id}`}
      title={t('custody.handOff.title', { defaultValue: 'Hand off to a colleague' })}
      submitLabel={t('custody.handOff.submit', { defaultValue: 'Hand off' })}
      isOpen={isOpen}
      onClose={onClose}
      canSubmit={Boolean(holder)}
      onSubmit={async () =>
        finish(
          await handOffCustody(custody.custody_id, { to_holder_user_id: holder, note: note.trim() || undefined }),
          onDone,
          onClose
        )
      }
    >
      <HolderPicker
        id={`custody-handoff-${custody.custody_id}-holder`}
        label={t('custody.handOff.newHolder', { defaultValue: 'New holder' })}
        value={holder}
        onChange={setHolder}
        placeholder={t('custody.handOff.selectHolder', { defaultValue: 'Select a person' })}
      />
      <NoteField id={`custody-handoff-${custody.custody_id}-note`} value={note} onChange={setNote} />
    </DialogShell>
  );
}

export function ShipCustodyDialog({ isOpen, onClose, custody, onDone }: StepDialogProps) {
  const { t } = useTranslation('msp/assets');
  const [counterparty, setCounterparty] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (isOpen) {
      setCounterparty('');
      setNote('');
    }
  }, [isOpen, custody.custody_id]);

  return (
    <DialogShell
      id={`custody-ship-${custody.custody_id}`}
      title={t('custody.ship.title', { defaultValue: 'Ship to vendor' })}
      description={t('custody.ship.description', {
        defaultValue: 'The item leaves the office. It stays in custody and shows as with the vendor.',
      })}
      submitLabel={t('custody.ship.submit', { defaultValue: 'Ship' })}
      isOpen={isOpen}
      onClose={onClose}
      canSubmit={counterparty.trim().length > 0}
      onSubmit={async () =>
        finish(
          await shipCustody(custody.custody_id, { counterparty: counterparty.trim(), note: note.trim() || undefined }),
          onDone,
          onClose
        )
      }
    >
      <div>
        <Label htmlFor={`custody-ship-${custody.custody_id}-counterparty`}>
          {t('custody.ship.counterparty', { defaultValue: 'Vendor or carrier' })}
        </Label>
        <Input
          id={`custody-ship-${custody.custody_id}-counterparty`}
          value={counterparty}
          maxLength={255}
          placeholder={t('custody.ship.counterpartyPlaceholder', { defaultValue: 'e.g. Dell RMA depot' })}
          onChange={(e) => setCounterparty(e.target.value)}
        />
      </div>
      <NoteField id={`custody-ship-${custody.custody_id}-note`} value={note} onChange={setNote} />
    </DialogShell>
  );
}

export function ReceiveBackCustodyDialog({ isOpen, onClose, custody, onDone }: StepDialogProps) {
  const { t } = useTranslation('msp/assets');
  const { locations } = useCustodyLocations(isOpen);
  const [locationId, setLocationId] = useState('');
  const [bin, setBin] = useState('');
  const [holder, setHolder] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLocationId('');
    setBin('');
    setHolder('');
    setNote('');
  }, [isOpen, custody.custody_id]);

  // Default to the tenant's default location once the list arrives.
  useEffect(() => {
    if (isOpen && !locationId && locations.length) {
      setLocationId((locations.find((l) => l.is_default) ?? locations[0]).location_id);
    }
  }, [isOpen, locationId, locations]);

  return (
    <DialogShell
      id={`custody-receive-back-${custody.custody_id}`}
      title={t('custody.receiveBack.title', { defaultValue: 'Receive back from vendor' })}
      submitLabel={t('custody.receiveBack.submit', { defaultValue: 'Receive back' })}
      isOpen={isOpen}
      onClose={onClose}
      canSubmit={Boolean(locationId)}
      onSubmit={async () =>
        finish(
          await receiveBackCustody(custody.custody_id, {
            location_id: locationId,
            bin: bin.trim() || null,
            holder_user_id: holder || undefined,
            note: note.trim() || undefined,
          }),
          onDone,
          onClose
        )
      }
    >
      <CustodyPlaceFields
        idPrefix={`custody-receive-back-${custody.custody_id}`}
        locations={locations}
        locationId={locationId}
        bin={bin}
        onLocationChange={setLocationId}
        onBinChange={setBin}
      />
      <HolderPicker
        id={`custody-receive-back-${custody.custody_id}-holder`}
        label={t('custody.receiveBack.holder', { defaultValue: 'Holder (defaults to you)' })}
        value={holder}
        onChange={setHolder}
        placeholder={t('custody.receiveBack.me', { defaultValue: 'Me' })}
      />
      <NoteField id={`custody-receive-back-${custody.custody_id}-note`} value={note} onChange={setNote} />
    </DialogShell>
  );
}

export function ReturnCustodyDialog({ isOpen, onClose, custody, onDone }: StepDialogProps) {
  const { t } = useTranslation('msp/assets');
  const [counterparty, setCounterparty] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (isOpen) {
      setCounterparty('');
      setNote('');
    }
  }, [isOpen, custody.custody_id]);

  return (
    <DialogShell
      id={`custody-return-${custody.custody_id}`}
      title={t('custody.return.title', { defaultValue: 'Return to client' })}
      description={t('custody.return.description', {
        defaultValue: 'This ends the custody episode. The item is no longer listed as in custody.',
      })}
      submitLabel={t('custody.return.submit', { defaultValue: 'Return to client' })}
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={async () =>
        finish(
          await returnCustodyToClient(custody.custody_id, {
            counterparty: counterparty.trim() || undefined,
            note: note.trim() || undefined,
          }),
          onDone,
          onClose
        )
      }
    >
      <div>
        <Label htmlFor={`custody-return-${custody.custody_id}-counterparty`}>
          {t('custody.return.collectedBy', { defaultValue: 'Collected by (optional)' })}
        </Label>
        <Input
          id={`custody-return-${custody.custody_id}-counterparty`}
          value={counterparty}
          maxLength={255}
          onChange={(e) => setCounterparty(e.target.value)}
        />
      </div>
      <NoteField id={`custody-return-${custody.custody_id}-note`} value={note} onChange={setNote} />
    </DialogShell>
  );
}

function detailsFromCustody(custody: IAssetCustodyDetail): CustodyDetailsValue {
  return {
    purpose: custody.purpose,
    next_action_party: custody.next_action_party,
    follow_up_on: custody.follow_up_on ?? '',
    next_action_note: custody.next_action_note ?? '',
    condition_note: custody.condition_note ?? '',
    accessories: custody.accessories ?? [],
  };
}

export function EditCustodyDialog({ isOpen, onClose, custody, onDone }: StepDialogProps) {
  const { t } = useTranslation('msp/assets');
  const [value, setValue] = useState<CustodyDetailsValue>(() => detailsFromCustody(custody));
  useEffect(() => {
    if (isOpen) setValue(detailsFromCustody(custody));
  }, [isOpen, custody]);

  // Send only what changed, so an untouched field never writes a history row.
  const patch = useMemo(() => {
    const before = detailsFromCustody(custody);
    const out: Record<string, unknown> = {};
    if (value.purpose !== before.purpose) out.purpose = value.purpose;
    if (value.next_action_party !== before.next_action_party) out.next_action_party = value.next_action_party;
    if (value.follow_up_on !== before.follow_up_on) out.follow_up_on = value.follow_up_on || null;
    if (value.next_action_note.trim() !== before.next_action_note.trim()) out.next_action_note = value.next_action_note.trim() || null;
    if (value.condition_note.trim() !== before.condition_note.trim()) out.condition_note = value.condition_note.trim() || null;
    const accessories = cleanAccessories(value.accessories);
    if (JSON.stringify(accessories) !== JSON.stringify(before.accessories)) out.accessories = accessories;
    return out;
  }, [value, custody]);

  return (
    <DialogShell
      id={`custody-edit-${custody.custody_id}`}
      title={t('custody.edit.title', { defaultValue: 'Edit custody details' })}
      submitLabel={t('custody.edit.submit', { defaultValue: 'Save' })}
      isOpen={isOpen}
      onClose={onClose}
      canSubmit={Object.keys(patch).length > 0}
      onSubmit={async () => finish(await updateCustody(custody.custody_id, patch as any), onDone, onClose)}
    >
      <CustodyDetailFields idPrefix={`custody-edit-${custody.custody_id}`} value={value} onChange={setValue} />
    </DialogShell>
  );
}

/** "Receive into custody" for an asset with no open episode (no ticket). */
export function OpenCustodyDialog({
  isOpen,
  onClose,
  assetId,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  assetId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation('msp/assets');
  const { locations } = useCustodyLocations(isOpen);
  const [locationId, setLocationId] = useState('');
  const [bin, setBin] = useState('');
  const [holder, setHolder] = useState('');
  const [details, setDetails] = useState<CustodyDetailsValue>(emptyCustodyDetails());

  useEffect(() => {
    if (!isOpen) return;
    setLocationId('');
    setBin('');
    setHolder('');
    setDetails(emptyCustodyDetails());
  }, [isOpen, assetId]);

  useEffect(() => {
    if (isOpen && !locationId && locations.length) {
      setLocationId((locations.find((l) => l.is_default) ?? locations[0]).location_id);
    }
  }, [isOpen, locationId, locations]);

  const id = `custody-open-${assetId}`;
  return (
    <DialogShell
      id={id}
      title={t('custody.open.title', { defaultValue: 'Receive into custody' })}
      description={t('custody.open.description', {
        defaultValue: 'Record that the MSP now holds this equipment. This does not create stock or touch billing.',
      })}
      submitLabel={t('custody.open.submit', { defaultValue: 'Receive' })}
      isOpen={isOpen}
      onClose={onClose}
      canSubmit={Boolean(locationId)}
      onSubmit={async () =>
        finish(
          await openAssetCustody({
            asset_id: assetId,
            ticket_id: null,
            purpose: details.purpose,
            location_id: locationId,
            bin: bin.trim() || null,
            holder_user_id: holder || undefined,
            next_action_party: details.next_action_party,
            next_action_note: details.next_action_note.trim() || null,
            follow_up_on: details.follow_up_on || null,
            condition_note: details.condition_note.trim() || null,
            accessories: cleanAccessories(details.accessories),
          }),
          onDone,
          onClose
        )
      }
    >
      <CustodyPlaceFields
        idPrefix={id}
        locations={locations}
        locationId={locationId}
        bin={bin}
        onLocationChange={setLocationId}
        onBinChange={setBin}
      />
      <HolderPicker
        id={`${id}-holder`}
        label={t('custody.open.holder', { defaultValue: 'Holder (defaults to you)' })}
        value={holder}
        onChange={setHolder}
        placeholder={t('custody.receiveBack.me', { defaultValue: 'Me' })}
      />
      <CustodyDetailFields idPrefix={id} value={details} onChange={setDetails} />
    </DialogShell>
  );
}

/** Renders the dialog for one step; used by the card and the queue's row actions. */
export function CustodyStepDialog({
  kind,
  custody,
  onClose,
  onDone,
}: {
  kind: CustodyDialogKind | null;
  custody: IAssetCustodyDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const common = { custody, onClose, onDone };
  return (
    <>
      <MoveCustodyDialog isOpen={kind === 'move'} {...common} />
      <HandOffCustodyDialog isOpen={kind === 'handOff'} {...common} />
      <ShipCustodyDialog isOpen={kind === 'ship'} {...common} />
      <ReceiveBackCustodyDialog isOpen={kind === 'receiveBack'} {...common} />
      <ReturnCustodyDialog isOpen={kind === 'return'} {...common} />
      <EditCustodyDialog isOpen={kind === 'edit'} {...common} />
    </>
  );
}
