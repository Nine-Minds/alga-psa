'use client';

import { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function AddCreditButton() {
  const { t } = useTranslation('msp/credits');
  const [isAddCreditModalOpen, setIsAddCreditModalOpen] = useState(false);

  const handleAddCredit = () => {
    console.log('Add credit submitted');
    setIsAddCreditModalOpen(false);
  };

  return (
    <>
      <Button
        id="add-credit-button"
        variant="default"
        onClick={() => setIsAddCreditModalOpen(true)}
      >
        {t('actions.addCredit', { defaultValue: 'Add Credit' })}
      </Button>

      <Dialog
        isOpen={isAddCreditModalOpen}
        onClose={() => setIsAddCreditModalOpen(false)}
        title={t('actions.addCredit', { defaultValue: 'Add Credit' })}
      >
        <DialogContent>
          <div className="py-4">
            <p className="text-muted-foreground">
              {t('management.addCreditPlaceholder', {
                defaultValue: 'Credit amount and details form would be implemented here.',
              })}
            </p>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="cancel-add-credit-button"
            variant="outline"
            onClick={() => setIsAddCreditModalOpen(false)}
          >
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id="submit-add-credit-button" onClick={handleAddCredit}>
            {t('actions.addCredit', { defaultValue: 'Add Credit' })}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
