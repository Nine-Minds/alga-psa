'use client';

import { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';

export default function AddCreditButton() {
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
        Add Credit
      </Button>

      <Dialog
        isOpen={isAddCreditModalOpen}
        onClose={() => setIsAddCreditModalOpen(false)}
        title="Add Credit"
      >
        <DialogContent>
          <div className="py-4">
            <p className="text-muted-foreground">
              Credit amount and details form would be implemented here.
            </p>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="cancel-add-credit-button"
            variant="outline"
            onClick={() => setIsAddCreditModalOpen(false)}
          >
            Cancel
          </Button>
          <Button id="submit-add-credit-button" onClick={handleAddCredit}>
            Add Credit
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

