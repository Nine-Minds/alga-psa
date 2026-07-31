import * as React from 'react';
import ClientAvatar from './ClientAvatar';
import { useTranslation } from '../lib/i18n/client';

interface ClientNameCellProps {
  clientId?: string | number | null;
  clientName?: string | null;
  /** Real uploaded logo; when null/undefined the avatar falls back to colored initials. */
  logoUrl?: string | null;
  /** Shown when there is no client. Defaults to the translated "No Client". */
  emptyLabel?: string;
  className?: string;
  /**
   * Custom name content rendered next to the avatar — e.g. a clickable link that
   * opens the client drawer. Defaults to the truncated client name.
   */
  children?: React.ReactNode;
}

/**
 * Standard datatable cell for a client/company name: a square xs avatar (real
 * logo when available, colored initials otherwise) followed by the client name.
 * Mirrors the tickets-list client column so every table reads the same.
 */
export const ClientNameCell = ({
  clientId,
  clientName,
  logoUrl = null,
  emptyLabel,
  className,
  children,
}: ClientNameCellProps) => {
  const { t } = useTranslation('common');
  const name = clientName?.trim();
  const resolvedEmptyLabel = emptyLabel ?? t('clientNameCell.noClient', { defaultValue: 'No Client' });

  if (!name && children == null) {
    return (
      <span className={`flex items-center gap-2 overflow-hidden text-[rgb(var(--color-text-500))] ${className ?? ''}`}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--color-border-300))] text-[10px] font-bold text-white">
          —
        </span>
        <span className="truncate">{resolvedEmptyLabel}</span>
      </span>
    );
  }

  return (
    <span className={`flex items-center gap-2 overflow-hidden ${className ?? ''}`}>
      <ClientAvatar clientId={clientId ?? name ?? ''} clientName={name ?? ''} logoUrl={logoUrl} size="xs" />
      {children ?? <span className="truncate">{name}</span>}
    </span>
  );
};

export default ClientNameCell;
