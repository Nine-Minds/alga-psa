'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { OutboundMailClass } from '@alga-psa/types';
import {
  clearEmailSenderRoute,
  listEmailSenders,
  setEmailSenderRoute,
} from '../../../actions/email-actions/emailSenderActions';

type Sender = { sender_id: string; email_address: string; display_name: string | null; verification_status: string; microsoft_provider_id?: string | null };
type Route = { route_type: 'default' | 'mail_class' | 'board'; mail_class: OutboundMailClass | null; board_id: string | null; sender_id: string | null; display_name: string | null };
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
  const [busy, setBusy] = useState(false);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('email.senderIdentities.addresses.title', 'Sender addresses')}</CardTitle>
        <CardDescription>{t('email.senderIdentities.addresses.description', 'Create named addresses to use across your outbound email.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {senders.length > 0 && <div className="divide-y divide-border rounded-md border border-border">
          {senders.map((sender) => <div key={sender.sender_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="font-medium text-foreground">{sender.display_name || sender.email_address}</div>
              <div className="text-sm text-muted-foreground">{sender.email_address}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={sender.verification_status === 'verified' ? 'success' : sender.verification_status === 'failed' ? 'error' : 'secondary'}>{t(`email.senderIdentities.status.${sender.verification_status}`, sender.verification_status)}</Badge>
              {sender.verification_status !== 'verified' && <Button id={`email-sender-verify-${sender.sender_id}`} variant="outline" size="sm" disabled={busy} onClick={() => void verify(sender.sender_id)}>{t('email.senderIdentities.actions.verify', 'Verify')}</Button>}
              <Button id={`email-sender-delete-${sender.sender_id}`} variant="outline" size="sm" disabled={busy} onClick={() => void remove(sender.sender_id)}>{t('email.senderIdentities.actions.delete', 'Delete')}</Button>
            </div>
          </div>)}
        </div>}
        <div className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-2">
          {transport === 'resend' ? <>
            <div className="space-y-2"><Label htmlFor="email-sender-local-part">{t('email.senderIdentities.fields.localPart', 'Address name')}</Label><Input id="email-sender-local-part" value={localPart} onChange={(event) => setLocalPart(event.target.value)} placeholder="support" /></div>
            <div className="space-y-2"><Label htmlFor="email-sender-domain">{t('email.senderIdentities.fields.domain', 'Verified domain')}</Label><CustomSelect id="email-sender-domain" value={domain} onValueChange={setDomain} options={verifiedDomains.map(item => ({ value: item, label: item }))} /></div>
          </> : <>
            <div className="space-y-2"><Label htmlFor="email-sender-address">{t('email.senderIdentities.fields.address', 'Email address')}</Label><Input id="email-sender-address" type="email" value={emailAddress} onChange={(event) => setEmailAddress(event.target.value)} placeholder="support@example.com" /></div>
            {transport === 'microsoft' && <div className="space-y-2"><Label htmlFor="email-sender-mailbox">{t('email.senderIdentities.fields.sendThrough', 'Send through')}</Label><CustomSelect id="email-sender-mailbox" value={microsoftProviderId} onValueChange={setMicrosoftProviderId} options={microsoftMailboxes.map(item => ({ value: item.providerId, label: item.mailbox }))} /></div>}
          </>}
          <div className="space-y-2"><Label htmlFor="email-sender-display-name">{t('email.senderIdentities.fields.displayName', 'Display name')}</Label><Input id="email-sender-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t('email.senderIdentities.fields.displayNamePlaceholder', 'Support team')} /></div>
          <div className="flex items-end"><Button id="email-sender-add" disabled={busy || (transport === 'resend' ? !localPart.trim() || !domain : !emailAddress.trim()) || (transport === 'microsoft' && !microsoftProviderId)} onClick={() => void addSender()}>{t('email.senderIdentities.actions.add', 'Add sender')}</Button></div>
          {transport === 'smtp' && <p className="text-xs text-muted-foreground md:col-span-2">{t('email.senderIdentities.smtpHelp', 'Your SMTP relay must allow this address.')}</p>}
          {transport === 'microsoft' && <p className="text-xs text-muted-foreground md:col-span-2">{t('email.senderIdentities.microsoftHelp', 'The connected mailbox needs Exchange Send As permission for this address.')}</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function EmailSenderRoutingCard({ t }: { t: Translate }) {
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

  const save = async (routeType: Route['route_type'], key: string, senderId: string, displayName: string) => {
    setBusyRoute(key);
    setError(null);
    try {
      const args = routeType === 'default'
        ? { routeType, senderId: senderId || null, displayName }
        : { routeType, mailClass: key as OutboundMailClass, senderId: senderId || null, displayName };
      if (!senderId && !displayName.trim()) await clearEmailSenderRoute(args as any);
      else await setEmailSenderRoute(args as any);
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
    return <RouteRow key={rowKey} id={`email-sender-route-${rowKey}`} title={t(`email.senderIdentities.routes.${rowKey}`, rowKey === 'default' ? 'Default (all other mail)' : rowKey)} routeType={routeType} routeKey={rowKey} route={route} value={value} options={options} busy={busyRoute === rowKey} t={t} onSave={(senderId, name) => void save(routeType, rowKey, senderId === '__default__' ? '' : senderId, name)} />;
  };

  return <Card>
    <CardHeader><CardTitle>{t('email.senderIdentities.routing.title', 'Sender routing')}</CardTitle><CardDescription>{t('email.senderIdentities.routing.description', 'Choose which sender each mail class uses.')}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="divide-y divide-border rounded-md border border-border">
        {renderRow('default', 'default')}
        {MAIL_CLASSES.map(mailClass => renderRow('mail_class', mailClass))}
      </div>
      <p className="text-sm text-muted-foreground">{t('email.senderIdentities.routing.boardSummary', 'Board-specific ticket senders are managed in each board’s settings.')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}

function RouteRow({ id, title, routeType, routeKey, route, value, options, busy, t, onSave }: {
  id: string; title: string; routeType: Route['route_type']; routeKey: string; route?: Route; value: string;
  options: Array<{ value: string; label: string }>; busy: boolean; t: Translate; onSave: (senderId: string, displayName: string) => void;
}) {
  const [senderId, setSenderId] = useState(value);
  const [displayName, setDisplayName] = useState(route?.display_name ?? '');
  useEffect(() => { setSenderId(value); setDisplayName(route?.display_name ?? ''); }, [value, route?.display_name]);
  const label = routeType === 'default' ? 'Default (all other mail)' : title;
  return <div className="grid gap-3 p-3 md:grid-cols-[minmax(8rem,1fr)_minmax(12rem,1.3fr)_minmax(10rem,1fr)_auto] md:items-end">
    <div className="pb-2 text-sm font-medium">{label}</div>
    <div className="space-y-1"><Label htmlFor={`${id}-sender`}>{t('email.senderIdentities.routes.sender', 'Sender')}</Label><CustomSelect id={`${id}-sender`} value={senderId} onValueChange={setSenderId} options={options} /></div>
    <div className="space-y-1"><Label htmlFor={`${id}-display-name`}>{t('email.senderIdentities.routes.displayName', 'Display name')}</Label><Input id={`${id}-display-name`} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div>
    <Button id={`${id}-save`} variant="outline" disabled={busy} onClick={() => onSave(senderId, displayName)}>{t('common.actions.save', 'Save')}</Button>
  </div>;
}
