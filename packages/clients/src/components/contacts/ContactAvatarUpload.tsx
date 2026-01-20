'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

interface ContactAvatarUploadProps {
  contactId: string;
  currentAvatarUrl?: string | null;
  onAvatarUpdated?: (newUrl: string | null) => void;
}

export default function ContactAvatarUpload({ contactId }: ContactAvatarUploadProps) {
  return (
    <Alert>
      <AlertDescription>
        Contact avatar upload is now owned by Client Portal. (contactId: {contactId})
      </AlertDescription>
    </Alert>
  );
}

