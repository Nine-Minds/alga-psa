'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import type { OutboundMailClass } from '@alga-psa/types';
import {
  clearEmailSenderRoute,
  listEmailSenders,
  setEmailSenderRoute,
} from '../../../actions/email-actions/emailSenderActions';

type Sender = { sender_id: string; email_address: string; display_name: string | null; verification_status: string; microsoft_provider_id?: string | null };
type Route = { route_id?: string; route_type: 'default' | 'mail_class' | 'board'; mail_class: OutboundMailClass | null; board_id: string | null; sender_id: string | null; display_name: string | null };
type Translate = (key: string, defaultValue: string) => string;

const MAIL_CLASSES: OutboundMailClass[] = ['ticket', 'project', 'billing', 'sales', 'scheduling', 'survey', 'account', 'general'];

export function EmailSenderAddressesCard({
  t,
  transport,
  verifiedDomains = [],
  microsoftMailboxes = [],
}: {
  t: Translate;
  transport: 'smtp' | 'resend' | 'microsoft';
  verifiedDomains?: string[];
  microsoftMailboxes?: Array<{ providerId: string; mailbox: string; providerName: string }>;
}) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [emailAddress, setEmailAddress] = useState('');
  const [localPart, setLocalPart] = useState('');
  const [domain, setDomain] = useState(verifiedDomains[0] ?? '');
  const [displayName, setDisplayName] = useState('');
  const [microsoftProviderId, setMicrosoftProviderId] = useState(microsoftMailboxes[0]?.providerId ?? '');
  const [editingSenderId, setEditingSenderId] = useState<string | null>(null);
  const [editAddress, setEditAddress] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const result = await listEmailSenders();
    setSenders(result.senders as Sender[]);
  };

  useEffect(() => { void reload().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);

  const addSender = async () => {
    setBusy(true);
    setError(null);
    try {
      const address = transport === 'resend' ? `${localPart.trim()}@${domain}` : emailAddress;
      await (await import('../../../actions/email-actions/emailSenderActions')).createEmailSender({
        emailAddress: address,
        displayName,
        microsoftProviderId: transport === 'microsoft' ? microsoftProviderId : null,
      });
      setEmailAddress('');
      setLocalPart('');
      setDisplayName('');
      await reload();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const verify = async (senderId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { verifyEmailSender } = await import('../../../actions/email-actions/emailSenderActions');
      await verifyEmailSender(senderId);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (senderId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { deleteEmailSender } = await import('../../../actions/email-actions/emailSenderActions');
      await deleteEmailSender(senderId);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (senderId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { updateEmailSender } = await import('../../../actions/email-actions/emailSenderActions');
      await updateEmailSender({ senderId, emailAddress: editAddress, displayName: editDisplayName });
      setEditingSenderId(null);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('email.senderIdentities.addresses.title', 'Sender addresses')}</CardTitle>
        <CardDescription>{t('email.senderIdentities.addresses.description', 'Create named addresses to use across your outbound email.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {senders.length > 0 && <div className="divide-y divide-border rounded-md border border-border">
          {senders.map((sender) => <div key={sender.sender_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0 flex-1">
              {editingSenderId === sender.sender_id ? <div className="grid gap-2 md:grid-cols-2">
                <Input aria-label={t('email.senderIdentities.fields.address', 'Email address')} value={editAddress} onChange={event => setEditAddress(event.target.value)} />
                <Input aria-label={t('email.senderIdentities.fields.displayName', 'Display name')} value={editDisplayName} onChange={event => setEditDisplayName(event.target.value)} />
              </div> : <>
              <div className="font-medium text-foreground">{sender.display_name || sender.email_address}</div>
              <div className="text-sm text-muted-foreground">{sender.email_address}</div>
              </>}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={sender.verification_status === 'verified' ? 'success' : sender.verification_status === 'failed' ? 'error' : 'secondary'}>{t(`email.senderIdentities.status.${sender.verification_status}`, sender.verification_status)}</Badge>
              {editingSenderId === sender.sender_id ? <><Button id={`email-sender-save-${sender.sender_id}`} variant="outline" size="sm" disabled={busy} onClick={() => void saveEdit(sender.sender_id)}>{t('common.actions.save', 'Save')}</Button><Button id={`email-sender-cancel-${sender.sender_id}`} variant="ghost" size="sm" onClick={() => setEditingSenderId(null)}>{t('common.actions.cancel', 'Cancel')}</Button></> : <Button id={`email-sender-edit-${sender.sender_id}`} variant="outline" size="sm" disabled={busy} onClick={() => { setEditingSenderId(sender.sender_id); setEditAddress(sender.email_address); setEditDisplayName(sender.display_name ?? ''); }}>{t('common.actions.edit', 'Edit')}</Button>}
              {sender.verification_status !== 'verified' && <Button id={`email-sender-verify-${sender.sender_id}`} variant="outline" size="sm" disabled={busy} onClick={() => void verify(sender.sender_id)}>{t('email.senderIdentities.actions.verify', 'Verify')}</Button>}
              <Button id={`email-sender-delete-${sender.sender_id}`} variant="outline" size="sm" disabled={busy} onClick={() => void remove(sender.sender_id)}>{t('email.senderIdentities.actions.delete', 'Delete')}</Button>
            </div>
          </div>)}
        </div>}
        <Button id="email-sender-add-open" onClick={() => setAddOpen(true)}>{t('email.senderIdentities.actions.add', 'Add sender')}</Button>
        <Dialog id="email-sender-add-dialog" isOpen={addOpen} onClose={() => setAddOpen(false)} title={t('email.senderIdentities.actions.add', 'Add sender')} footer={<div className="flex justify-end gap-2"><Button id="email-sender-add-cancel" variant="outline" onClick={() => setAddOpen(false)}>{t('common.actions.cancel', 'Cancel')}</Button><Button id="email-sender-add" disabled={busy || (transport === 'resend' ? !localPart.trim() || !domain : !emailAddress.trim()) || (transport === 'microsoft' && !microsoftProviderId)} onClick={() => { void addSender().then(success => { if (success) setAddOpen(false); }); }}>{t('email.senderIdentities.actions.add', 'Add sender')}</Button></div>}>
        <DialogContent>
        <DialogDescription>{t('email.senderIdentities.addresses.description', 'Create named addresses to use across your outbound email.')}</DialogDescription>
        <div className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-2">
          {transport === 'resend' ? <>
            <div className="space-y-2"><Label htmlFor="email-sender-local-part">{t('email.senderIdentities.fields.localPart', 'Address name')}</Label><Input id="email-sender-local-part" value={localPart} onChange={(event) => setLocalPart(event.target.value)} placeholder="support" /></div>
            <div className="space-y-2"><Label htmlFor="email-sender-domain">{t('email.senderIdentities.fields.domain', 'Verified domain')}</Label><CustomSelect id="email-sender-domain" value={domain} onValueChange={setDomain} options={verifiedDomains.map(item => ({ value: item, label: item }))} /></div>
          </> : <>
            <div className="space-y-2"><Label htmlFor="email-sender-address">{t('email.senderIdentities.fields.address', 'Email address')}</Label><Input id="email-sender-address" type="email" value={emailAddress} onChange={(event) => setEmailAddress(event.target.value)} placeholder="support@example.com" /></div>
            {transport === 'microsoft' && <div className="space-y-2"><Label htmlFor="email-sender-mailbox">{t('email.senderIdentities.fields.sendThrough', 'Send through')}</Label><CustomSelect id="email-sender-mailbox" value={microsoftProviderId} onValueChange={setMicrosoftProviderId} options={microsoftMailboxes.map(item => ({ value: item.providerId, label: item.mailbox }))} /></div>}
          </>}
          <div className="space-y-2"><Label htmlFor="email-sender-display-name">{t('email.senderIdentities.fields.displayName', 'Display name')}</Label><Input id="email-sender-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t('email.senderIdentities.fields.displayNamePlaceholder', 'Support team')} /></div>
          {transport === 'smtp' && <p className="text-xs text-muted-foreground md:col-span-2">{t('email.senderIdentities.smtpHelp', 'Your SMTP relay must allow this address.')}</p>}
          {transport === 'microsoft' && <p className="text-xs text-muted-foreground md:col-span-2">{t('email.senderIdentities.microsoftHelp', 'The connected mailbox needs Exchange Send As permission for this address.')}</p>}
        </div>
        </DialogContent>
        </Dialog>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function EmailSenderRoutingCard({ t, transport = 'resend' }: { t: Translate; transport?: 'smtp' | 'resend' | 'microsoft' }) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [busyRoute, setBusyRoute] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const data = await listEmailSenders();
    setSenders(data.senders as Sender[]);
    setRoutes(data.routes as Route[]);
  };
  useEffect(() => { void reload().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);

  const save = async (routeType: Route['route_type'], key: string, senderId: string, displayName: string, confirmUnverifiedSmtpSender: boolean) => {
    setBusyRoute(key);
    setError(null);
    try {
      const args = routeType === 'default'
        ? { routeType, senderId: senderId || null, displayName }
        : { routeType, mailClass: key as OutboundMailClass, senderId: senderId || null, displayName };
      if (!senderId && !displayName.trim()) await clearEmailSenderRoute(args as any);
      else await setEmailSenderRoute({ ...args, confirmUnverifiedSmtpSender } as any);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRoute(null);
    }
  };

  const renderRow = (routeType: Route['route_type'], key: string) => {
    const route = routes.find(item => item.route_type === routeType && (routeType === 'default' || item.mail_class === key));
    const rowKey = routeType === 'default' ? 'default' : key;
    const value = route?.sender_id ?? '__default__';
    const options = routeType === 'default'
      ? senders.map(sender => ({ value: sender.sender_id, label: sender.email_address }))
      : [{ value: '__default__', label: t('email.senderIdentities.routes.useDefault', 'Use default') }, ...senders.map(sender => ({ value: sender.sender_id, label: sender.email_address }))];
    return <RouteRow key={rowKey} id={`email-sender-route-${rowKey}`} title={t(`email.senderIdentities.routes.${rowKey}`, rowKey === 'default' ? 'Default (all other mail)' : rowKey)} routeType={routeType} routeKey={rowKey} route={route} value={value} options={options} senders={senders} transport={transport} busy={busyRoute === rowKey} t={t} onSave={(senderId, name, confirm) => void save(routeType, rowKey, senderId === '__default__' ? '' : senderId, name, confirm)} />;
  };

  return <Card>
    <CardHeader><CardTitle>{t('email.senderIdentities.routing.title', 'Sender routing')}</CardTitle><CardDescription>{t('email.senderIdentities.routing.description', 'Choose which sender each mail class uses.')}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="divide-y divide-border rounded-md border border-border">
        {renderRow('default', 'default')}
        {MAIL_CLASSES.map(mailClass => renderRow('mail_class', mailClass))}
      </div>
      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-sm text-muted-foreground">{t('email.senderIdentities.routing.boardSummary', 'Board-specific ticket senders are managed in each board’s settings.')}</p>
        {routes.filter(route => route.route_type === 'board').map(route => {
          const sender = senders.find(item => item.sender_id === route.sender_id);
          return <p key={route.route_id ?? route.board_id} className="text-sm text-foreground">{route.board_id}: {sender?.email_address ?? t('email.senderIdentities.routes.useDefault', 'Use ticket default')}{route.display_name ? ` · ${route.display_name}` : ''}</p>;
        })}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}

function RouteRow({ id, title, routeType, routeKey, route, value, options, senders, transport, busy, t, onSave }: {
  id: string; title: string; routeType: Route['route_type']; routeKey: string; route?: Route; value: string;
  options: Array<{ value: string; label: string }>; senders: Sender[]; transport: 'smtp' | 'resend' | 'microsoft'; busy: boolean; t: Translate; onSave: (senderId: string, displayName: string, confirm: boolean) => void;
}) {
  const [senderId, setSenderId] = useState(value);
  const [displayName, setDisplayName] = useState(route?.display_name ?? '');
  const [confirmUnverifiedSmtpSender, setConfirmUnverifiedSmtpSender] = useState(false);
  useEffect(() => { setSenderId(value); setDisplayName(route?.display_name ?? ''); }, [value, route?.display_name]);
  const label = routeType === 'default' ? 'Default (all other mail)' : title;
  return <div className="grid gap-3 p-3 md:grid-cols-[minmax(8rem,1fr)_minmax(12rem,1.3fr)_minmax(10rem,1fr)_auto] md:items-end">
    <div className="pb-2 text-sm font-medium">{label}</div>
    <div className="space-y-1"><Label htmlFor={`${id}-sender`}>{t('email.senderIdentities.routes.sender', 'Sender')}</Label><CustomSelect id={`${id}-sender`} value={senderId} onValueChange={setSenderId} options={options} /></div>
    <div className="space-y-1"><Label htmlFor={`${id}-display-name`}>{t('email.senderIdentities.routes.displayName', 'Display name')}</Label><Input id={`${id}-display-name`} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div>
    {transport === 'smtp' && senderId !== '__default__' && senders.find(sender => sender.sender_id === senderId)?.verification_status !== 'verified' && <label className="flex gap-2 text-xs text-muted-foreground md:col-span-3"><input type="checkbox" checked={confirmUnverifiedSmtpSender} onChange={event => setConfirmUnverifiedSmtpSender(event.target.checked)} />{t('email.senderIdentities.routes.confirmSmtp', 'I confirm the SMTP relay accepts this sender address.')}</label>}
    <Button id={`${id}-save`} variant="outline" disabled={busy || (transport === 'smtp' && senderId !== '__default__' && senders.find(sender => sender.sender_id === senderId)?.verification_status !== 'verified' && !confirmUnverifiedSmtpSender)} onClick={() => onSave(senderId, displayName, confirmUnverifiedSmtpSender)}>{t('common.actions.save', 'Save')}</Button>
    {routeKey === 'ticket' && <p className="text-xs text-muted-foreground md:col-span-4">{t('email.senderIdentities.routes.inboundReplyWarning', 'Inbound replies still go to the configured inbound mailbox; changing this From address does not change reply routing.')}</p>}
  </div>;
}
