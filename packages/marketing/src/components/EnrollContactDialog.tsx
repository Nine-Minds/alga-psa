'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IContact, IMarketingSequence } from '@alga-psa/types';
import { enrollContactInSequence } from '../actions/sequenceActions';

/** Enroll a single contact into a sequence. */
export function EnrollContactDialog({
  sequence,
  contacts,
  isOpen,
  onClose,
  onCompleted,
}: {
  sequence: IMarketingSequence | null;
  contacts: IContact[];
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}): React.ReactElement {
  const { t } = useTranslation('msp/core');
  const [contactId, setContactId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setContactId('');
  }, [isOpen]);

  const submit = async () => {
    if (!sequence || !contactId) return;
    setSaving(true);
    try {
      await enrollContactInSequence(sequence.sequence_id, { contact_id: contactId });
      toast.success(t('marketing.sequences.toast.enrolled', 'Contact enrolled'));
      onClose();
      onCompleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="marketing-enroll-contact-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('marketing.sequences.enrollDialog.title', 'Enroll contact')}
    >
      <div className="space-y-4 pt-1">
        <ContactPicker
          id="marketing-enroll-contact-picker"
          contacts={contacts}
          value={contactId}
          onValueChange={setContactId}
          label={t('marketing.sequences.enrollDialog.contact', 'Contact')}
          placeholder={t('marketing.sequences.enrollDialog.contactPlaceholder', 'Select a contact…')}
          buttonWidth="full"
        />
        <div className="flex justify-end gap-2">
          <Button
            id="marketing-enroll-contact-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t('marketing.dialogs.cancel', 'Cancel')}
          </Button>
          <Button
            id="marketing-enroll-contact-submit"
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={!contactId || saving}
          >
            {t('marketing.sequences.enrollDialog.submit', 'Enroll')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
