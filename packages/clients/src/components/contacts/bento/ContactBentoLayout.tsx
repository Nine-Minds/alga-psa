'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BriefcaseBusiness,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mail,
  MessageSquarePlus,
  NotebookPen,
  Phone,
  ShieldCheck,
  Ticket,
  UserRound,
} from 'lucide-react';
import type { IClient, IContact, IDocument, IInteraction, ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento/BentoTile';
import { TagManager } from '@alga-psa/tags/components';
import { useToast } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { updateContact } from '@alga-psa/clients/actions';
import { QuickAddInteraction } from '../../interactions/QuickAddInteraction';
import { ContactPortalTab } from '../ContactPortalTab';
import type {
  ContactRelatedWorkSummary,
  ContactStatsSummary,
  ContactTicketsSummary,
} from '../../../actions/contact-actions/contactBentoActions';

type PortalPermissions = {
  canInvite: boolean;
  canUpdateRoles: boolean;
  canRead: boolean;
};

interface ContactBentoLayoutProps {
  id?: string;
  contact: IContact;
  clients: IClient[];
  documents?: IDocument[];
  interactions?: IInteraction[];
  tags?: ITag[];
  stats?: ContactStatsSummary | null;
  ticketsSummary?: ContactTicketsSummary | null;
  relatedWork?: ContactRelatedWorkSummary | null;
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

function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
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

function RowLink({
  href,
  title,
  meta,
}: {
  href: string;
  title: string;
  meta?: string;
}) {
  return (
    <Link
      href={href}
      className="block min-w-0 rounded-md px-2 py-2 hover:bg-[rgb(var(--color-border-100))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-400))]"
    >
      <div className="truncate text-sm font-medium text-[rgb(var(--color-text-800))]">{title}</div>
      {meta ? <div className="truncate text-xs text-[rgb(var(--color-text-500))]">{meta}</div> : null}
    </Link>
  );
}

export function ContactBentoLayout({
  id = 'contact-bento',
  contact: initialContact,
  clients,
  documents = [],
  interactions = [],
  tags = [],
  stats,
  ticketsSummary,
  relatedWork,
  userId,
  userPermissions = { canInvite: false, canUpdateRoles: false, canRead: false },
  quickView = false,
  clientReadOnly = false,
  onContactUpdated,
  onChangesSaved,
  onDocumentCreated,
}: ContactBentoLayoutProps) {
  const { t } = useTranslation('msp/contacts');
  const { toast } = useToast();
  const { renderDocuments } = useDocumentsCrossFeature();
  const [contact, setContact] = useState(initialContact);
  const [roleDraft, setRoleDraft] = useState(contact.role ?? '');
  const [notesDraft, setNotesDraft] = useState(contact.notes ?? '');
  const [isSavingField, setIsSavingField] = useState<string | null>(null);
  const [isPortalOpen, setIsPortalOpen] = useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
  const [isInteractionOpen, setIsInteractionOpen] = useState(false);

  const clientName = useMemo(
    () => clients.find((client) => client.client_id === contact.client_id)?.client_name ?? null,
    [clients, contact.client_id],
  );

  const primaryPhone = contact.default_phone_number
    || contact.phone_numbers?.find((phone) => phone.is_default)?.phone_number
    || contact.phone_numbers?.[0]?.phone_number
    || null;
  const primaryPhoneType = contact.phone_numbers?.find((phone) => phone.phone_number === primaryPhone);
  const portalState = contact.is_inactive ? 'Inactive' : contact.is_client_admin ? 'Admin' : userPermissions.canRead ? 'Available' : 'None';
  const visibleStats = quickView
    ? [
        { label: 'Open tickets', value: String(stats?.openTickets ?? ticketsSummary?.openCount ?? 0), subline: `${stats?.urgentTickets ?? ticketsSummary?.urgentCount ?? 0} urgent` },
        { label: 'Last touch', value: stats?.lastInteraction?.date ? formatDate(stats.lastInteraction.date) : '—', subline: stats?.lastInteraction?.type ?? 'No interactions yet' },
      ]
    : [
        { label: 'Open tickets', value: String(stats?.openTickets ?? ticketsSummary?.openCount ?? 0), subline: `${stats?.urgentTickets ?? ticketsSummary?.urgentCount ?? 0} urgent · ${stats?.totalTickets ?? ticketsSummary?.totalCount ?? 0} total` },
        { label: 'Last touch', value: stats?.lastInteraction?.date ? formatDate(stats.lastInteraction.date) : '—', subline: stats?.lastInteraction?.title ?? 'No interactions yet' },
        { label: 'Satisfaction', value: stats?.satisfaction.count ? (stats.satisfaction.average ?? 0).toFixed(1) : '—', subline: stats?.satisfaction.count ? `${stats.satisfaction.count} responses` : 'No surveys yet' },
        { label: 'Portal', value: portalState, subline: contact.is_client_admin ? 'Client admin' : 'Standard contact' },
      ];

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
      toast({
        title: t('contactBento.toast.saveFailed', { defaultValue: 'Could not update contact' }),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsSavingField(null);
    }
  };

  const hero = (
    <BentoTile id={`${id}-hero`} className="col-span-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
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
              <span className="rounded-full border border-[rgb(var(--color-border-200))] px-2 py-0.5 text-xs font-medium text-[rgb(var(--color-text-600))]">
                {portalState}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[rgb(var(--color-text-600))]">
              <span className="truncate">{contact.email ? `${contact.email} · ${emailType(contact)}` : 'No primary email'}</span>
              <span className="hidden text-[rgb(var(--color-text-300))] sm:inline">•</span>
              <span className="truncate">{primaryPhone ? `${primaryPhone}${primaryPhoneType ? ` · ${phoneType(primaryPhoneType)}` : ''}` : 'No phone number'}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[10px] font-semibold uppercase text-[rgb(var(--color-text-400))]">Role</span>
                <Input
                  id={`${id}-role-input`}
                  value={roleDraft}
                  onChange={(event) => setRoleDraft(event.target.value)}
                  onBlur={() => {
                    if (roleDraft !== (contact.role ?? '')) void saveField('role', roleDraft);
                  }}
                  disabled={isSavingField === 'role'}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-semibold uppercase text-[rgb(var(--color-text-400))]">Client</span>
                <ClientPicker
                  id={`${id}-client-picker`}
                  clients={clients}
                  selectedClientId={contact.client_id ?? null}
                  onSelect={(value: string | null) => void saveField('client_id', value)}
                  filterState="all"
                  onFilterStateChange={() => {}}
                  clientTypeFilter="all"
                  onClientTypeFilterChange={() => {}}
                  disabled={clientReadOnly || isSavingField === 'client_id'}
                  placeholder={clientName ?? 'No client'}
                />
              </label>
            </div>
            {contact.contact_name_id ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase text-[rgb(var(--color-text-400))]">Tags</span>
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
        <div className="flex shrink-0 flex-col gap-2 text-xs text-[rgb(var(--color-text-500))] lg:items-end">
          <span>Contact since {formatDate(contact.created_at)}</span>
          <span>Last updated {formatDate(contact.updated_at)}</span>
          <label className="mt-1 flex items-center gap-2 text-sm text-[rgb(var(--color-text-700))]">
            <Switch
              checked={!contact.is_inactive}
              onCheckedChange={(checked) => void saveField('is_inactive', !checked)}
              disabled={isSavingField === 'is_inactive'}
            />
            Active
          </label>
        </div>
      </div>
      <div className={`mt-4 grid border-t border-[rgb(var(--color-border-200))] pt-3 ${quickView ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {visibleStats.map((stat, index) => (
          <div key={stat.label} className={`min-w-0 px-3 first:pl-0 ${index > 0 ? 'border-l border-[rgb(var(--color-border-200))]' : ''}`}>
            <div className="text-[10px] font-semibold uppercase text-[rgb(var(--color-text-400))]">{stat.label}</div>
            <div className="truncate text-base font-semibold text-[rgb(var(--color-text-900))]">{stat.value}</div>
            <div className="truncate text-xs text-[rgb(var(--color-text-500))]">{stat.subline}</div>
          </div>
        ))}
      </div>
    </BentoTile>
  );

  const reachTile = (
    <BentoTile id={`${id}-reach-tile`} title="Reach" icon={<Mail className="h-4 w-4" />} className={quickView ? '' : 'lg:col-span-4 col-span-12'}>
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase text-[rgb(var(--color-text-400))]">Email</div>
          {contact.email ? (
            <div className="truncate text-sm text-[rgb(var(--color-text-800))]">{contact.email} <span className="text-xs text-[rgb(var(--color-text-500))]">Primary</span></div>
          ) : (
            <BentoTileEmpty id={`${id}-email-empty`}>No primary email</BentoTileEmpty>
          )}
          {(contact.additional_email_addresses ?? []).slice(0, 3).map((email) => (
            <div key={email.contact_additional_email_address_id ?? email.email_address} className="truncate text-sm text-[rgb(var(--color-text-700))]">
              {email.email_address} <span className="text-xs text-[rgb(var(--color-text-500))]">{email.custom_type || email.canonical_type || 'Other'}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase text-[rgb(var(--color-text-400))]">Phone</div>
          {contact.phone_numbers?.length ? contact.phone_numbers.slice(0, 4).map((phone) => (
            <div key={phone.contact_phone_number_id ?? phone.phone_number} className="truncate text-sm text-[rgb(var(--color-text-700))]">
              {phone.phone_number} <span className="text-xs text-[rgb(var(--color-text-500))]">{phone.is_default ? 'Primary · ' : ''}{phoneType(phone)}</span>
            </div>
          )) : (
            <BentoTileEmpty id={`${id}-phone-empty`}>No phone numbers</BentoTileEmpty>
          )}
        </div>
      </div>
    </BentoTile>
  );

  const portalTile = userPermissions.canRead ? (
    <BentoTile
      id={`${id}-portal-tile`}
      title="Portal access"
      icon={<ShieldCheck className="h-4 w-4" />}
      className={quickView ? '' : 'lg:col-span-4 col-span-12'}
      action={<Button id={`${id}-portal-manage`} size="sm" variant="ghost" onClick={() => setIsPortalOpen(true)}>Manage</Button>}
    >
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-[rgb(var(--color-text-500))]">Status</dt><dd className="font-medium text-[rgb(var(--color-text-800))]">{portalState}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[rgb(var(--color-text-500))]">Role</dt><dd className="font-medium text-[rgb(var(--color-text-800))]">{contact.is_client_admin ? 'Client admin' : 'Standard'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[rgb(var(--color-text-500))]">Visibility</dt><dd className="truncate font-medium text-[rgb(var(--color-text-800))]">{contact.portal_visibility_group_id ? 'Custom group' : 'Default'}</dd></div>
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

  return (
    <div id={id} className="grid grid-cols-12 gap-3">
      {hero}
      <BentoTile
        id={`${id}-tickets-tile`}
        title="Tickets"
        icon={<Ticket className="h-4 w-4" />}
        className="col-span-12 lg:col-span-8"
        action={<Button id={`${id}-tickets-view-all`} size="sm" variant="ghost" asChild><Link href={`/msp/tickets?contactId=${contact.contact_name_id}`}>View all {ticketsSummary?.totalCount ?? 0}</Link></Button>}
      >
        {ticketsSummary?.rows.length ? ticketsSummary.rows.map((ticket) => (
          <RowLink
            key={ticket.ticket_id}
            href={`/msp/tickets/${ticket.ticket_id}`}
            title={ticket.title || `Ticket ${ticket.ticket_number ?? ''}`}
            meta={`#${ticket.ticket_number ?? '—'} · ${ticket.status_name ?? 'No status'} · ${formatDate(ticket.entered_at)}`}
          />
        )) : (
          <BentoTileEmpty id={`${id}-tickets-empty`}>No tickets yet</BentoTileEmpty>
        )}
      </BentoTile>
      {reachTile}
      <BentoTile
        id={`${id}-interactions-tile`}
        title="Interactions"
        icon={<MessageSquarePlus className="h-4 w-4" />}
        className="col-span-12 lg:col-span-8"
        action={
          <div className="flex items-center gap-1">
            <Button id={`${id}-interactions-log`} size="sm" variant="ghost" onClick={() => setIsInteractionOpen(true)}>Log</Button>
            <Button id={`${id}-interactions-view-all`} size="sm" variant="ghost" asChild><Link href={`/msp/contacts/${contact.contact_name_id}/activity`}>View all</Link></Button>
          </div>
        }
      >
        {interactions.length ? interactions.slice(0, 5).map((interaction) => (
          <div key={interaction.interaction_id} className="rounded-md px-2 py-2">
            <div className="truncate text-sm font-medium text-[rgb(var(--color-text-800))]">{interaction.title || interaction.type_name || 'Interaction'}</div>
            <div className="truncate text-xs text-[rgb(var(--color-text-500))]">
              {[interaction.type_name, formatDateTime(interaction.interaction_date), interaction.user_name].filter(Boolean).join(' · ')}
            </div>
          </div>
        )) : (
          <BentoTileEmpty id={`${id}-interactions-empty`}>No interactions logged</BentoTileEmpty>
        )}
      </BentoTile>
      {portalTile}
      <BentoTile
        id={`${id}-documents-tile`}
        title="Documents"
        icon={<FileText className="h-4 w-4" />}
        className="col-span-12 lg:col-span-4"
        action={<Button id={`${id}-documents-view-all`} size="sm" variant="ghost" onClick={() => setIsDocumentsOpen(true)}>View all {documents.length}</Button>}
      >
        {documents.length ? documents.slice(0, 4).map((document) => (
          <div key={document.document_id} className="rounded-md px-2 py-2">
            <div className="truncate text-sm font-medium text-[rgb(var(--color-text-800))]">{document.document_name || (document as any).file_name || 'Document'}</div>
            <div className="truncate text-xs text-[rgb(var(--color-text-500))]">{formatDate((document as any).updated_at || (document as any).created_at)}</div>
          </div>
        )) : (
          <BentoTileEmpty id={`${id}-documents-empty`}>No documents yet</BentoTileEmpty>
        )}
      </BentoTile>
      <BentoTile id={`${id}-related-work-tile`} title="Related work" icon={<BriefcaseBusiness className="h-4 w-4" />} className="col-span-12 lg:col-span-4">
        {relatedWork?.projects.length || relatedWork?.quotes.length ? (
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase text-[rgb(var(--color-text-400))]">Projects</div>
              {relatedWork.projects.length ? relatedWork.projects.map((project) => (
                <RowLink key={project.project_id} href={`/msp/projects/${project.project_id}`} title={project.project_name || `Project ${project.project_number ?? ''}`} meta={project.status_name ?? 'No status'} />
              )) : <BentoTileEmpty id={`${id}-projects-empty`}>No projects</BentoTileEmpty>}
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase text-[rgb(var(--color-text-400))]">Quotes</div>
              {relatedWork.quotes.length ? relatedWork.quotes.map((quote) => (
                <RowLink key={quote.quote_id} href={`/msp/billing?tab=quotes&quoteId=${quote.quote_id}`} title={quote.title || quote.quote_number || 'Quote'} meta={`${centsToMoney(quote.total_amount, quote.currency_code)} · ${quote.status ?? 'No status'}`} />
              )) : <BentoTileEmpty id={`${id}-quotes-empty`}>No quotes</BentoTileEmpty>}
            </div>
          </div>
        ) : (
          <BentoTileEmpty id={`${id}-related-empty`}>No related projects or quotes</BentoTileEmpty>
        )}
      </BentoTile>
      <BentoTile id={`${id}-notes-tile`} title="Notes" icon={<NotebookPen className="h-4 w-4" />} className="col-span-12 lg:col-span-4">
        {contact.notes_document_id ? (
          <Link className="inline-flex items-center gap-1 text-sm font-medium text-[rgb(var(--color-primary-600))]" href={`/msp/documents/${contact.notes_document_id}`}>
            Open note document <ExternalLink className="h-3 w-3" />
          </Link>
        ) : (
          <div className="space-y-2">
            <TextArea
              id={`${id}-notes-textarea`}
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              rows={6}
              placeholder="No notes yet"
            />
            <Button
              id={`${id}-notes-save`}
              size="sm"
              disabled={notesDraft === (contact.notes ?? '') || isSavingField === 'notes'}
              onClick={() => void saveField('notes', notesDraft)}
            >
              Save notes
            </Button>
          </div>
        )}
      </BentoTile>

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
