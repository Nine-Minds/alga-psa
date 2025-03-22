'use client'

import { useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';

export default function AddCreditButton() {
  const [isAddCreditModalOpen, setIsAddCreditModalOpen] = useState(false);
  
  const handleAddCredit = () => {
    // In a real implementation, this would submit the form data
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
      
      {/* Add Credit Modal */}
      <Dialog isOpen={isAddCreditModalOpen} onClose={() => setIsAddCreditModalOpen(false)}>
        <DialogHeader>
          <DialogTitle>Add Credit</DialogTitle>
        </DialogHeader>
        <DialogContent>
          {/* Add credit form would go here */}
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
          <Button 
            id="submit-add-credit-button"
            onClick={handleAddCredit}
          >
            Add Credit
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}