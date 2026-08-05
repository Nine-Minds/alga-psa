'use client';

import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Mail, Send } from 'lucide-react';

export interface EmailSenderIdentityCopy {
  ticketTitle: string;
  ticketDescription: string;
  connectedInboxLabel: string;
  connectedInboxHelp: string;
  customAddressOption: string;
  ticketAddressLabel: string;
  ticketAddressPlaceholder: string;
  ticketAddressHelp: string;
  ticketNameLabel: string;
  ticketNamePlaceholder: string;
  ticketNameHelp: string;
  warningTitle: string;
  errorTitle: string;
  notificationTitle: string;
  notificationDescription: string;
  notificationAddressLabel: string;
  notificationAddressPlaceholder: string;
  notificationAddressHelp: string;
  notificationNameLabel: string;
  notificationNamePlaceholder: string;
  notificationNameHelp: string;
}

interface EmailSenderIdentityCardsProps {
  copy: EmailSenderIdentityCopy;
  ticketAddress: string;
  ticketName: string;
  connectedInboxes?: string[];
  ticketAddressReadOnly?: boolean;
  ticketFieldsDisabled?: boolean;
  ticketWarning?: string | null;
  ticketError?: string | null;
  notificationAddress: string;
  notificationName: string;
  notificationAddressReadOnly?: boolean;
  notificationFieldsDisabled?: boolean;
  onTicketAddressChange: (value: string) => void;
  onTicketNameChange: (value: string) => void;
  onNotificationAddressChange: (value: string) => void;
  onNotificationNameChange: (value: string) => void;
  actions?: ReactNode;
}

export function EmailSenderIdentityCards({
  copy,
  ticketAddress,
  ticketName,
  connectedInboxes = [],
  ticketAddressReadOnly = false,
  ticketFieldsDisabled = false,
  ticketWarning,
  ticketError,
  notificationAddress,
  notificationName,
  notificationAddressReadOnly = false,
  notificationFieldsDisabled = false,
  onTicketAddressChange,
  onTicketNameChange,
  onNotificationAddressChange,
  onNotificationNameChange,
  actions,
}: EmailSenderIdentityCardsProps) {
  const normalizedTicketAddress = ticketAddress.trim().toLowerCase();
  const matchedInbox = connectedInboxes.find(
    mailbox => mailbox.toLowerCase() === normalizedTicketAddress
  );
  const ticketAddressOption = matchedInbox || 'custom';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              {copy.ticketTitle}
            </CardTitle>
            <CardDescription>{copy.ticketDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!ticketAddressReadOnly && connectedInboxes.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="ticket-from-inbox">{copy.connectedInboxLabel}</Label>
                <CustomSelect
                  id="ticket-from-inbox"
                  value={ticketAddressOption}
                  disabled={ticketFieldsDisabled}
                  onValueChange={(value: string) => {
                    onTicketAddressChange(value === 'custom' ? '' : value);
                  }}
                  options={[
                    ...connectedInboxes.map(mailbox => ({ value: mailbox, label: mailbox })),
                    { value: 'custom', label: copy.customAddressOption },
                  ]}
                  placeholder={copy.connectedInboxLabel}
                />
                <p className="text-xs text-muted-foreground">{copy.connectedInboxHelp}</p>
              </div>
            )}

            {(ticketAddressReadOnly || connectedInboxes.length === 0 || ticketAddressOption === 'custom') && (
              <div className="space-y-2">
                <Label htmlFor="ticket-from-address">{copy.ticketAddressLabel}</Label>
                <Input
                  id="ticket-from-address"
                  type="email"
                  value={ticketAddress}
                  readOnly={ticketAddressReadOnly}
                  disabled={ticketFieldsDisabled}
                  placeholder={copy.ticketAddressPlaceholder}
                  onChange={(event) => onTicketAddressChange(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{copy.ticketAddressHelp}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ticket-from-name">{copy.ticketNameLabel}</Label>
              <Input
                id="ticket-from-name"
                value={ticketName}
                disabled={ticketFieldsDisabled}
                placeholder={copy.ticketNamePlaceholder}
                onChange={(event) => onTicketNameChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{copy.ticketNameHelp}</p>
            </div>

            {ticketWarning && (
              <Alert variant="warning">
                <AlertTitle>{copy.warningTitle}</AlertTitle>
                <AlertDescription>{ticketWarning}</AlertDescription>
              </Alert>
            )}
            {ticketError && (
              <Alert variant="destructive">
                <AlertTitle>{copy.errorTitle}</AlertTitle>
                <AlertDescription>{ticketError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {copy.notificationTitle}
            </CardTitle>
            <CardDescription>{copy.notificationDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="notification-from-address">{copy.notificationAddressLabel}</Label>
              <Input
                id="notification-from-address"
                type="email"
                value={notificationAddress}
                readOnly={notificationAddressReadOnly}
                disabled={notificationFieldsDisabled}
                placeholder={copy.notificationAddressPlaceholder}
                onChange={(event) => onNotificationAddressChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{copy.notificationAddressHelp}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notification-from-name">{copy.notificationNameLabel}</Label>
              <Input
                id="notification-from-name"
                value={notificationName}
                disabled={notificationFieldsDisabled}
                placeholder={copy.notificationNamePlaceholder}
                onChange={(event) => onNotificationNameChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{copy.notificationNameHelp}</p>
            </div>
          </CardContent>
        </Card>
      </div>
      {actions}
    </div>
  );
}
