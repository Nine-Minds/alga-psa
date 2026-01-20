'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import type { IContact } from '@alga-psa/types';

interface ContactPortalTabProps {
  contact: IContact;
  currentUserPermissions: {
    canInvite: boolean;
    canUpdateRoles: boolean;
    canRead: boolean;
  };
}

export function ContactPortalTab({ contact }: ContactPortalTabProps) {
  return (
    <Alert>
      <AlertDescription>
        Client Portal management for this contact is owned by the Client Portal slice. (contactId:{' '}
        {contact.contact_name_id})
      </AlertDescription>
    </Alert>
  );
}

