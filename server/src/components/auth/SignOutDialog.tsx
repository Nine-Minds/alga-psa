'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';

interface SignOutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SignOutDialog({ isOpen, onClose }: SignOutDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSignOut = async () => {
    setIsLoading(true);
    await signOut({ callbackUrl: '/auth/signin?callbackUrl=/client-portal/dashboard' });
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Sign Out</DialogTitle>
        <DialogDescription>
          Are you sure you want to sign out?
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          id='cancel-button'
          variant="outline"
          onClick={onClose}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button
          id='sign-out-button'
          onClick={handleSignOut}
          disabled={isLoading}
        >
          {isLoading ? 'Signing out...' : 'Sign out'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
