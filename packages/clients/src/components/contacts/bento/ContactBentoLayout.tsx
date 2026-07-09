'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BriefcaseBusiness,
  ExternalLink,
  FileText,
  Mail,
  MessageSquarePlus,
  NotebookPen,
  Pencil,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import type { IClient, IContact, IDocument, IInteraction, ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { InteractionIcon } from '@alga-psa/ui/components/InteractionIcon';
import { BentoTile, BentoTileAddButton, BentoTileEmpty, BentoTileEmptyAction } from '@alga-psa/ui/components/bento/BentoTile';
import { TagManager } from '@alga-psa/tags/components';
import { useToast, useDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { updateContact, getInteractionsForEntity } from '@alga-psa/clients/actions';
import { useOptionalClientCrossFeature } from '../../../context/ClientCrossFeatureContext';
import { QuickAddInteraction } from '../../interactions/QuickAddInteraction';
import InteractionDetails from '../../interactions/InteractionDetails';
import { ContactPortalTab } from '../ContactPortalTab';
import ContactDetailsEdit from '../ContactDetailsEdit';
import type {
  ContactPortalSummary,
  ContactRelatedWorkSummary,
  ContactStatsSummary,
  ContactTicketsSummary,
} from '../../../actions/contact-actions/contactBentoActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type PortalPermissions = {
  canInvite: boolean;
  canUpdateRoles: boolean;
  canRead: boolean;
};
const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface ContactBentoLayoutProps {
  id?: string;
  contact: IContact;
  clients: IClient[];
  documents?: IDocument[];
  /** AlgaDesk composes contact details without the PSA documents surface. */
  showDocuments?: boolean;
  interactions?: IInteraction[];
  tags?: ITag[];
  stats?: ContactStatsSummary | null;
  ticketsSummary?: ContactTicketsSummary | null;
  relatedWork?: ContactRelatedWorkSummary | null;
  portalSummary?: ContactPortalSummary | null;
  /** Prebuilt create-ticket route href (built by the page; clients can't depend on the tickets package). */
  newTicketHref?: string;
  userId?: string;
  userPermissions?: PortalPermissions;
  quickView?: boolean;
  clientReadOnly?: boolean;
  onContactUpdated?: () => Promise<void> | void;
  onChangesSaved?: () => void;
  onDocumentCreated?: () => Promise<void>;
}

function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

function relativeDays(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days}d ago`;
  return null;
}

function emailType(contact: IContact): string {
  return contact.primary_email_type || contact.primary_email_custom_type || contact.primary_email_canonical_type || 'Primary';
}

function phoneType(phone: IContact['phone_numbers'][number]): string {
  return phone.custom_type || phone.canonical_type || 'Other';
}

function centsToMoney(value: string | number | null, currencyCode?: string | null): string {
  if (value == null) return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode || 'USD',
  }).format(amount / 100);
}

function statusChipClass(isPositive: boolean) {
  return isPositive
    ? 'border-[rgb(var(--badge-success-border))] bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))]'
    : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] text-[rgb(var(--color-text-600))]';
}

const URGENT_LEVELS = new Set(['critical', 'high', 'urgent']);

function ticketPill(row: NonNullable<ContactTicketsSummary>['rows'][number]): { label: string; className: string } {
  if (row.is_closed) {
    return { label: row.status_name || 'Closed', className: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))]' };
  }
  if (URGENT_LEVELS.has((row.urgency ?? '').toLowerCase()) || (row.itil_urgency != null && row.itil_urgency <= 2)) {
    return { label: 'Urgent', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' };
  }
  if ((row.status_name ?? '').toLowerCase().includes('wait')) {
    return { label: row.status_name as string, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' };
  }
  return { label: row.status_name || 'Open', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' };
}

function documentBadge(document: IDocument): string {
  const name = ((document as any).file_name as string | undefined) || document.document_name || '';
  const dotIndex = name.lastIndexOf('.');
  const ext = dotIndex > 0 ? name.slice(dotIndex + 1) : '';
  if (ext && ext.length <= 4) return ext.toUpperCase();
  const mimeSubtype = ((document as any).mime_type as string | undefined)?.split('/')[1];
  if (mimeSubtype) {
    const cleaned = mimeSubtype.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
    if (cleaned) return cleaned;
  }
  return 'DOC';
}

/** Hairline-separated single-line rows: content left, metadata right-aligned. */
function TileRows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-[rgb(var(--color-border-100))]">{children}</div>;
}

function TileRow({
  href,
  onClick,
  leading,
  primary,
  meta,
  emphasize = true,
}: {
  href?: string;
  onClick?: () => void;
  leading?: React.ReactNode;
  primary: React.ReactNode;
  meta?: React.ReactNode;
  emphasize?: boolean;
}) {
  const body = (
    <>
      {leading}
      <span className={`min-w-0 truncate text-sm ${emphasize ? 'font-medium text-[rgb(var(--color-text-800))]' : 'text-[rgb(var(--color-text-700))]'}`}>
        {primary}
      </span>
      {meta != null ? <span className="ml-auto shrink-0 pl-3 text-xs text-[rgb(var(--color-text-500))]">{meta}</span> : null}
    </>
  );
  const interactiveClassName =
    'flex min-w-0 items-center gap-2 py-2 hover:bg-[rgb(var(--color-border-50))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-400))]';
  if (href) {
    return (
      <Link href={href} className={interactiveClassName}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`w-full text-left ${interactiveClassName}`}>
        {body}
      </button>
    );
  }
  return <div className="flex min-w-0 items-center gap-2 py-2">{body}</div>;
}

function Eyebrow({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))] ${first ? '' : 'mt-3'}`}>
      {children}
    </div>
  );
}

export function ContactBentoLayout({
  id = 'contact-bento',
  contact: initialContact,
  clients,
  documents = [],
  showDocuments = true,
  interactions: initialInteractions,
  tags = [],
  stats,
  ticketsSummary,
  relatedWork,
  portalSummary,
  newTicketHref,
  userPermissions = { canInvite: false, canUpdateRoles: false, canRead: false },
  quickView = false,
  onContactUpdated,
  onChangesSaved,
  onDocumentCreated,
}: ContactBentoLayoutProps) {
  const { t } = useTranslation('msp/contacts');
  const { toast } = useToast();
  const { renderDocuments } = useDocumentsCrossFeature();
  const { openDrawer, closeDrawer } = useDrawer();
  // Composition-provided ticket drawer (MSP + AlgaDesk); rows fall back to
  // navigation when no provider is mounted.
  const openTicketDetails = useOptionalClientCrossFeature()?.openTicketDetails ?? null;
  const [contact, setContact] = useState(initialContact);
  const [roleDraft, setRoleDraft] = useState(contact.role ?? '');
  const [isEditingRole, setIsEditingRole] = useState(false);
  const [notesDraft, setNotesDraft] = useState(contact.notes ?? '');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isSavingField, setIsSavingField] = useState<string | null>(null);
  const [isPortalOpen, setIsPortalOpen] = useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
  const [isInteractionOpen, setIsInteractionOpen] = useState(false);

  // The interactions list is owned here: server pages can't pass refresh
  // callbacks across the RSC boundary, and quick-view callers don't pass
  // interactions at all — so the tile refetches its own rows.
  const [interactions, setInteractions] = useState<IInteraction[]>(initialInteractions ?? []);
  const [interactionsErrorMessage, setInteractionsErrorMessage] = useState<string | null>(null);
  const refreshInteractions = useCallback(async () => {
    try {
      const rows = await getInteractionsForEntity(contact.contact_name_id, 'contact');
      if (isReturnedActionError(rows)) {
        setInteractionsErrorMessage(getErrorMessage(rows));
        return;
      }
      setInteractionsErrorMessage(null);
      setInteractions(rows);
    } catch (error) {
      console.error('Failed to refresh contact interactions:', error);
      setInteractionsErrorMessage('Interactions could not be loaded. Please try again.');
      // Keep the current rows; the drawer/dialog that changed data already surfaced its own errors.
    }
  }, [contact.contact_name_id]);
  useEffect(() => {
    if (initialInteractions === undefined) {
      void refreshInteractions();
    }
    // Seed-once semantics (same as the contact buffer above): only an absent
    // prop triggers a fetch, so server-provided lists are never double-loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshInteractions]);

  const openInteractionDetails = (interaction: IInteraction) => {
    openDrawer(
      <InteractionDetails
        interaction={interaction}
        isInDrawer
        onInteractionDeleted={() => void refreshInteractions()}
        onInteractionUpdated={() => void refreshInteractions()}
      />,
    );
  };

  const clientName = useMemo(
    () => clients.find((client) => client.client_id === contact.client_id)?.client_name ?? null,
    [clients, contact.client_id],
  );

  const primaryPhone = contact.default_phone_number
    || contact.phone_numbers?.find((phone) => phone.is_default)?.phone_number
    || contact.phone_numbers?.[0]?.phone_number
    || null;
  const primaryPhoneEntry = contact.phone_numbers?.find((phone) => phone.phone_number === primaryPhone);

  const portalChip = (() => {
    if (!portalSummary) return null;
    if (portalSummary.hasAccount) {
      if (portalSummary.accountInactive) return 'Portal · deactivated';
      const rel = relativeDays(portalSummary.lastSignIn);
      if (rel) return `Portal · signed in ${rel}`;
      return portalSummary.lastSignIn ? `Portal · signed in ${formatDate(portalSummary.lastSignIn)}` : 'Portal · never signed in';
    }
    if (portalSummary.invitedAt) return 'Portal · invited';
    return 'No portal access';
  })();

  const saveField = async (field: keyof IContact, value: string | boolean | null) => {
    const previous = contact;
    const next = { ...contact, [field]: value };
    setContact(next);
    setIsSavingField(String(field));
    try {
      const updated = await updateContact({
        contact_name_id: contact.contact_name_id,
        [field]: value,
      } as Partial<IContact>);
      if (isReturnedActionError(updated)) {
        setContact(previous);
        setRoleDraft(previous.role ?? '');
        setNotesDraft(previous.notes ?? '');
        toast({
          title: t('contactBento.toast.saveFailed', { defaultValue: 'Could not update contact' }),
          description: getErrorMessage(updated),
          variant: 'destructive',
        });
        return;
      }
      setContact(updated);
      onChangesSaved?.();
      await onContactUpdated?.();
      toast({
        title: t('contactBento.toast.saved', { defaultValue: 'Contact updated' }),
      });
    } catch (error) {
      setContact(previous);
      setRoleDraft(previous.role ?? '');
      setNotesDraft(previous.notes ?? '');
      console.error('Failed to update contact field:', error);
      toast({
        title: t('contactBento.toast.saveFailed', { defaultValue: 'Could not update contact' }),
        description: t('contactBento.toast.saveFailedDescription', { defaultValue: 'The contact could not be updated. Please try again.' }),
        variant: 'destructive',
      });
    } finally {
      setIsSavingField(null);
    }
  };

  const openEditDrawer = () => {
    openDrawer(
      <ContactDetailsEdit
        id={`${id}-edit`}
        initialContact={contact}
        clients={clients}
        isInDrawer
        onSave={(updated) => {
          setContact(updated);
          setRoleDraft(updated.role ?? '');
          setNotesDraft(updated.notes ?? '');
          closeDrawer();
          void onContactUpdated?.();
        }}
        onCancel={closeDrawer}
      />,
    );
  };

  const commitRole = () => {
    setIsEditingRole(false);
    if (roleDraft !== (contact.role ?? '')) void saveField('role', roleDraft);
  };

  const hero = (
    <BentoTile id={`${id}-hero`} className="col-span-12">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <ContactAvatar
            contactId={contact.contact_name_id}
            contactName={contact.full_name}
            avatarUrl={contact.avatarUrl || null}
            size="lg"
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-bold text-[rgb(var(--color-text-900))]">{contact.full_name}</h1>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusChipClass(!contact.is_inactive)}`}>
                {contact.is_inactive ? 'Inactive' : 'Active'}
              </span>
              {portalChip ? (
                <span className="rounded-full border border-[rgb(var(--color-border-200))] px-2 py-0.5 text-xs font-medium text-[rgb(var(--color-text-600))]">
                  {portalChip}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[rgb(var(--color-text-600))]">
              {isEditingRole ? (
                <input
                  id={`${id}-role-input`}
                  autoFocus
                  value={roleDraft}
                  onChange={(event) => setRoleDraft(event.target.value)}
                  onBlur={commitRole}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRole();
                    if (event.key === 'Escape') {
                      setRoleDraft(contact.role ?? '');
                      setIsEditingRole(false);
                    }
                  }}
                  disabled={isSavingField === 'role'}
                  placeholder="Add role"
                  className="w-40 rounded-sm border border-[rgb(var(--color-border-200))] bg-transparent px-1 py-0 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-400))]"
                />
              ) : (
                <button
                  id={`${id}-role-edit`}
                  type="button"
                  onClick={() => setIsEditingRole(true)}
                  title="Click to edit role"
                  className={`cursor-text border-b border-dashed border-[rgb(var(--color-border-300))] ${contact.role ? 'font-medium text-[rgb(var(--color-text-700))]' : 'text-[rgb(var(--color-text-400))]'}`}
                >
                  {contact.role || 'Add role'}
                </button>
              )}
              {contact.client_id && clientName ? (
                <span>
                  at{' '}
                  <Link
                    id={`${id}-client-link`}
                    href={`/msp/clients/${contact.client_id}`}
                    className="font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                  >
                    {clientName}
                  </Link>
                </span>
              ) : (
                <span className="text-[rgb(var(--color-text-400))]">No client</span>
              )}
              <span className="truncate">{contact.email || 'No primary email'}</span>
              <span className="truncate">
                {primaryPhone ? `${primaryPhone}${primaryPhoneEntry ? ` · ${phoneType(primaryPhoneEntry).toLowerCase()}` : ''}` : 'No phone number'}
              </span>
            </div>
            {contact.contact_name_id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TagManager
                  entityId={contact.contact_name_id}
                  entityType="contact"
                  initialTags={tags}
                  onTagsChange={() => void onContactUpdated?.()}
                  useInlineInput
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1 text-xs text-[rgb(var(--color-text-500))] lg:items-end">
          <span>Contact since {formatDate(contact.created_at)}</span>
          <span>
            Last touch{' '}
            {stats?.lastInteraction?.date
              ? `${formatDate(stats.lastInteraction.date)}${stats.lastInteraction.type ? ` · ${stats.lastInteraction.type.toLowerCase()}` : ''}`
              : '—'}
          </span>
          <Button id={`${id}-edit-contact`} size="sm" variant="outline" onClick={openEditDrawer} className="mt-1">
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit contact
          </Button>
        </div>
      </div>
    </BentoTile>
  );

  const reachTile = (
    <BentoTile
      id={`${id}-reach-tile`}
      title="Reach"
      icon={<Mail className="h-4 w-4" />}
      action={<BentoTileAddButton id={`${id}-reach-add`} label="Add email or phone" onClick={openEditDrawer} />}
    >
      <Eyebrow first>Email</Eyebrow>
      <TileRows>
        {contact.email ? (
          <TileRow
            primary={contact.email}
            meta={`${emailType(contact).toLowerCase()} · primary`}
            emphasize={false}
          />
        ) : null}
        {(contact.additional_email_addresses ?? []).slice(0, 3).map((email) => (
          <TileRow
            key={email.contact_additional_email_address_id ?? email.email_address}
            primary={email.email_address}
            meta={(email.custom_type || email.canonical_type || 'other').toLowerCase()}
            emphasize={false}
          />
        ))}
      </TileRows>
      {!contact.email && !(contact.additional_email_addresses ?? []).length ? (
        <div>
          <BentoTileEmpty id={`${id}-email-empty`}>No email addresses</BentoTileEmpty>
          <BentoTileEmptyAction id={`${id}-email-add`} onClick={openEditDrawer}>Add an email</BentoTileEmptyAction>
        </div>
      ) : null}
      <Eyebrow>Phone</Eyebrow>
      {contact.phone_numbers?.length ? (
        <TileRows>
          {contact.phone_numbers.slice(0, 4).map((phone) => (
            <TileRow
              key={phone.contact_phone_number_id ?? phone.phone_number}
              primary={phone.phone_number}
              meta={[phoneType(phone).toLowerCase(), phone.is_default ? 'primary' : null].filter(Boolean).join(' · ')}
              emphasize={false}
            />
          ))}
        </TileRows>
      ) : (
        <div>
          <BentoTileEmpty id={`${id}-phone-empty`}>No phone numbers</BentoTileEmpty>
          <BentoTileEmptyAction id={`${id}-phone-add`} onClick={openEditDrawer}>Add a phone number</BentoTileEmptyAction>
        </div>
      )}
    </BentoTile>
  );

  const portalStatus = (() => {
    if (!portalSummary) return { label: '—', positive: false };
    if (portalSummary.hasAccount) {
      return portalSummary.accountInactive
        ? { label: 'Deactivated', positive: false }
        : { label: 'Active account', positive: true };
    }
    if (portalSummary.invitedAt) return { label: 'Invitation sent', positive: false };
    return { label: 'No access', positive: false };
  })();

  const portalTile = userPermissions.canRead ? (
    <BentoTile
      id={`${id}-portal-tile`}
      title="Portal access"
      icon={<ShieldCheck className="h-4 w-4" />}
      action={<Button id={`${id}-portal-manage`} size="sm" variant="ghost" onClick={() => setIsPortalOpen(true)}>Manage</Button>}
    >
      <dl className="text-sm">
        <div className="flex justify-between gap-3 py-0.5">
          <dt className="text-[rgb(var(--color-text-500))]">Status</dt>
          <dd className={`font-medium ${portalStatus.positive ? 'text-[rgb(var(--badge-success-text))]' : 'text-[rgb(var(--color-text-800))]'}`}>
            {portalStatus.label}
          </dd>
        </div>
        <div className="flex justify-between gap-3 py-0.5">
          <dt className="text-[rgb(var(--color-text-500))]">Role</dt>
          <dd className="font-medium text-[rgb(var(--color-text-800))]">{contact.is_client_admin ? 'Client admin' : 'Standard'}</dd>
        </div>
        <div className="flex justify-between gap-3 py-0.5">
          <dt className="text-[rgb(var(--color-text-500))]">Last sign-in</dt>
          <dd className="font-medium text-[rgb(var(--color-text-800))]">{portalSummary?.lastSignIn ? formatDate(portalSummary.lastSignIn) : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 py-0.5">
          <dt className="text-[rgb(var(--color-text-500))]">Invited</dt>
          <dd className="font-medium text-[rgb(var(--color-text-800))]">{portalSummary?.invitedAt ? formatDate(portalSummary.invitedAt) : '—'}</dd>
        </div>
      </dl>
    </BentoTile>
  ) : null;

  if (quickView) {
    return (
      <div id={id} className="space-y-3 p-4">
        {hero}
        {reachTile}
        {portalTile}
        <Button id={`${id}-open-full-page`} asChild className="w-full">
          <Link href={`/msp/contacts/${contact.contact_name_id}`}>Open full page</Link>
        </Button>
        <PortalDialog />
      </div>
    );
  }

  const ticketsTile = (
      <BentoTile
        id={`${id}-tickets-tile`}
        title="Tickets"
        icon={<Ticket className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-1">
            <Button id={`${id}-tickets-view-all`} size="sm" variant="ghost" asChild><Link href={`/msp/tickets?contactId=${contact.contact_name_id}`}>View all {ticketsSummary?.totalCount ?? 0}</Link></Button>
            {newTicketHref ? <BentoTileAddButton id={`${id}-tickets-add`} label="Create ticket" href={newTicketHref} /> : null}
          </div>
        }
      >
        {ticketsSummary?.rows.length ? (
          <TileRows>
            {ticketsSummary.rows.map((ticket) => {
              const pill = ticketPill(ticket);
              return (
                <TileRow
                  key={ticket.ticket_id}
                  {...(openTicketDetails
                    ? { onClick: () => void openTicketDetails(ticket.ticket_id) }
                    : { href: `/msp/tickets/${ticket.ticket_id}` })}
                  leading={<span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill.className}`}>{pill.label}</span>}
                  primary={ticket.title || `Ticket ${ticket.ticket_number ?? ''}`}
                  meta={`#${ticket.ticket_number ?? '—'} · ${formatDate(ticket.entered_at)}`}
                />
              );
            })}
          </TileRows>
        ) : (
          <div>
            <BentoTileEmpty id={`${id}-tickets-empty`}>No tickets yet</BentoTileEmpty>
            {newTicketHref ? (
              <BentoTileEmptyAction id={`${id}-tickets-create`} href={newTicketHref}>Create a ticket</BentoTileEmptyAction>
            ) : null}
          </div>
        )}
      </BentoTile>
  );

  const interactionsTile = (
      <BentoTile
        id={`${id}-interactions-tile`}
        title="Interactions"
        icon={<MessageSquarePlus className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-1">
            <Button id={`${id}-interactions-view-all`} size="sm" variant="ghost" asChild><Link href={`/msp/contacts/${contact.contact_name_id}/activity`}>View all</Link></Button>
            <BentoTileAddButton id={`${id}-interactions-log`} label="Log interaction" onClick={() => setIsInteractionOpen(true)} />
          </div>
        }
      >
        {interactionsErrorMessage ? (
          <BentoTileEmpty id={`${id}-interactions-error`}>{interactionsErrorMessage}</BentoTileEmpty>
        ) : interactions.length ? (
          <TileRows>
            {interactions.slice(0, 5).map((interaction) => (
              <TileRow
                key={interaction.interaction_id}
                onClick={() => openInteractionDetails(interaction)}
                leading={<InteractionIcon icon={interaction.icon} typeName={interaction.type_name} size="sm" className="shrink-0" />}
                primary={interaction.title || interaction.type_name || 'Interaction'}
                meta={[
                  formatDate(interaction.interaction_date),
                  interaction.duration ? `${interaction.duration}m` : null,
                  interaction.user_name,
                ].filter(Boolean).join(' · ')}
              />
            ))}
          </TileRows>
        ) : (
          <div>
            <BentoTileEmpty id={`${id}-interactions-empty`}>No interactions logged</BentoTileEmpty>
            <BentoTileEmptyAction id={`${id}-interactions-log-first`} onClick={() => setIsInteractionOpen(true)}>Log an interaction</BentoTileEmptyAction>
          </div>
        )}
      </BentoTile>
  );

  const documentsTile = (
      <BentoTile
        id={`${id}-documents-tile`}
        title="Documents"
        icon={<FileText className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-1">
            <Button id={`${id}-documents-view-all`} size="sm" variant="ghost" onClick={() => setIsDocumentsOpen(true)}>View all {documents.length}</Button>
            <BentoTileAddButton id={`${id}-documents-add`} label="Add document" onClick={() => setIsDocumentsOpen(true)} />
          </div>
        }
      >
        {documents.length ? (
          <TileRows>
            {documents.slice(0, 4).map((document) => (
              <TileRow
                key={document.document_id}
                leading={
                  <span className="shrink-0 rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-1 py-px text-[9px] font-semibold tracking-wide text-[rgb(var(--color-text-500))]">
                    {documentBadge(document)}
                  </span>
                }
                primary={document.document_name || (document as any).file_name || 'Document'}
                meta={formatDate((document as any).updated_at || (document as any).created_at)}
                emphasize={false}
              />
            ))}
          </TileRows>
        ) : (
          <div>
            <BentoTileEmpty id={`${id}-documents-empty`}>No documents yet</BentoTileEmpty>
            <BentoTileEmptyAction id={`${id}-documents-add-first`} onClick={() => setIsDocumentsOpen(true)}>Add a document</BentoTileEmptyAction>
          </div>
        )}
      </BentoTile>
  );

  const relatedWorkTile = (
      <BentoTile id={`${id}-related-work-tile`} title="Related work" icon={<BriefcaseBusiness className="h-4 w-4" />}>
        {relatedWork?.projects.length || relatedWork?.quotes.length ? (
          <div>
            <Eyebrow first>Projects</Eyebrow>
            {relatedWork.projects.length ? (
              <TileRows>
                {relatedWork.projects.map((project) => (
                  <TileRow
                    key={project.project_id}
                    href={`/msp/projects/${project.project_id}`}
                    primary={project.project_name || `Project ${project.project_number ?? ''}`}
                    meta={(project.status_name ?? 'No status').toLowerCase()}
                    emphasize={false}
                  />
                ))}
              </TileRows>
            ) : <BentoTileEmpty id={`${id}-projects-empty`}>No projects</BentoTileEmpty>}
            <Eyebrow>Quotes</Eyebrow>
            {relatedWork.quotes.length ? (
              <TileRows>
                {relatedWork.quotes.map((quote) => (
                  <TileRow
                    key={quote.quote_id}
                    href={`/msp/billing?tab=quotes&quoteId=${quote.quote_id}`}
                    primary={quote.title || quote.quote_number || 'Quote'}
                    meta={`${(quote.status ?? 'no status').toLowerCase()} · ${centsToMoney(quote.total_amount, quote.currency_code)}`}
                    emphasize={false}
                  />
                ))}
              </TileRows>
            ) : <BentoTileEmpty id={`${id}-quotes-empty`}>No quotes</BentoTileEmpty>}
          </div>
        ) : (
          <BentoTileEmpty id={`${id}-related-empty`}>No related projects or quotes</BentoTileEmpty>
        )}
      </BentoTile>
  );

  const notesTile = (
      <BentoTile
        id={`${id}-notes-tile`}
        title="Notes"
        icon={<NotebookPen className="h-4 w-4" />}
        action={
          !contact.notes_document_id && !isEditingNotes && contact.notes ? (
            <Button
              id={`${id}-notes-edit`}
              size="sm"
              variant="ghost"
              onClick={() => {
                setNotesDraft(contact.notes ?? '');
                setIsEditingNotes(true);
              }}
            >
              Edit
            </Button>
          ) : undefined
        }
      >
        {contact.notes_document_id ? (
          <Link className="inline-flex items-center gap-1 text-sm font-medium text-[rgb(var(--color-primary-600))]" href={`/msp/documents/${contact.notes_document_id}`}>
            Open note document <ExternalLink className="h-3 w-3" />
          </Link>
        ) : isEditingNotes ? (
          <div className="space-y-2">
            <TextArea
              id={`${id}-notes-textarea`}
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              rows={5}
              placeholder="No notes yet"
            />
            <div className="flex items-center gap-2">
              <Button
                id={`${id}-notes-save`}
                size="sm"
                disabled={isSavingField === 'notes'}
                onClick={async () => {
                  await saveField('notes', notesDraft);
                  setIsEditingNotes(false);
                }}
              >
                Save notes
              </Button>
              <Button
                id={`${id}-notes-cancel`}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNotesDraft(contact.notes ?? '');
                  setIsEditingNotes(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : contact.notes ? (
          <p className="whitespace-pre-wrap text-sm text-[rgb(var(--color-text-700))]">{contact.notes}</p>
        ) : (
          <div>
            <BentoTileEmpty id={`${id}-notes-empty`}>No notes yet</BentoTileEmpty>
            <BentoTileEmptyAction
              id={`${id}-notes-add`}
              onClick={() => {
                setNotesDraft(contact.notes ?? '');
                setIsEditingNotes(true);
              }}
            >
              Add notes
            </BentoTileEmptyAction>
          </div>
        )}
      </BentoTile>
  );

  return (
    <div id={id} className="grid grid-cols-12 gap-3 items-start">
      {hero}
      {/* Independent rails so tile heights don't row-align across columns. */}
      <div className="col-span-12 lg:col-span-8 min-w-0 flex flex-col gap-3">
        {ticketsTile}
        {interactionsTile}
      </div>
      <div className="col-span-12 lg:col-span-4 min-w-0 flex flex-col gap-3">
        {reachTile}
        {portalTile}
        {showDocuments ? documentsTile : null}
        {relatedWorkTile}
        {notesTile}
      </div>

      <PortalDialog />
      <Dialog
        isOpen={isDocumentsOpen}
        onClose={() => setIsDocumentsOpen(false)}
        title="Contact documents"
        className="max-w-4xl"
      >
        <DialogContent>
          {renderDocuments({
            entityId: contact.contact_name_id,
            entityType: 'contact',
            documents,
            onDocumentCreated,
          } as any)}
        </DialogContent>
      </Dialog>
      <QuickAddInteraction
        id={`${id}-quick-add-interaction`}
        entityId={contact.contact_name_id}
        entityType="contact"
        clientId={contact.client_id ?? undefined}
        isOpen={isInteractionOpen}
        onClose={() => setIsInteractionOpen(false)}
        onInteractionAdded={() => {
          setIsInteractionOpen(false);
          void refreshInteractions();
          void onContactUpdated?.();
        }}
      />
    </div>
  );

  function PortalDialog() {
    return (
      <Dialog
        isOpen={isPortalOpen}
        onClose={() => setIsPortalOpen(false)}
        title="Portal access"
        className="max-w-3xl"
      >
        <DialogContent>
          <ContactPortalTab contact={contact} currentUserPermissions={userPermissions} />
        </DialogContent>
      </Dialog>
    );
  }
}

export default ContactBentoLayout;
