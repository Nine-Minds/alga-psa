'use client';

import React from 'react';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export type TicketNotificationSuppressionValue = {
  suppressContactNotifications: boolean;
  suppressInternalNotifications: boolean;
};

interface TicketNotificationSuppressionControlProps {
  value: TicketNotificationSuppressionValue;
  onChange: (value: TicketNotificationSuppressionValue) => void;
  idPrefix?: string;
  disabled?: boolean;
  className?: string;
}

export default function TicketNotificationSuppressionControl({
  value,
  onChange,
  idPrefix = 'ticket-notification-suppression',
  disabled = false,
  className = '',
}: TicketNotificationSuppressionControlProps): React.ReactElement {
  const { t } = useTranslation('features/tickets');

  const contactChecked = value.suppressContactNotifications;
  const internalChecked = contactChecked && value.suppressInternalNotifications;
  const contactId = `${idPrefix}-suppress-contact-notifications`;
  const contactHelperId = `${contactId}-helper`;
  const internalId = `${idPrefix}-suppress-internal-notifications`;

  const setContactSuppression = (checked: boolean) => {
    onChange({
      suppressContactNotifications: checked,
      suppressInternalNotifications: checked ? value.suppressInternalNotifications : false,
    });
  };

  const setInternalSuppression = (checked: boolean) => {
    onChange({
      suppressContactNotifications: true,
      suppressInternalNotifications: checked,
    });
  };

  return (
    <div className={`space-y-2 ${className}`} data-testid={`${idPrefix}-control`}>
      <div>
        <Checkbox
          id={contactId}
          checked={contactChecked}
          disabled={disabled}
          aria-describedby={contactHelperId}
          label={t('notifications.suppression.contactLabel', "Don't notify contact")}
          onChange={(event) => setContactSuppression(event.currentTarget.checked)}
        />
        <p id={contactHelperId} className="mt-1 pl-6 text-xs text-[rgb(var(--color-text-600))]">
          {t(
            'notifications.suppression.contactHelper',
            'Skips the customer email, survey invitation, and client-portal notification'
          )}
        </p>
      </div>
      <div className="pl-6">
        <Checkbox
          id={internalId}
          checked={internalChecked}
          disabled={disabled || !contactChecked}
          label={t('notifications.suppression.internalLabel', 'Also skip internal notifications')}
          onChange={(event) => setInternalSuppression(event.currentTarget.checked)}
        />
      </div>
    </div>
  );
}
