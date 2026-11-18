'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { getCoManagedPasswordStatus } from '@/lib/actions/coManagedAcceptanceActions';
import PasswordChangeForm from '@alga-psa/users/components/settings/PasswordChangeForm';
import { DrawerProvider, DrawerOutlet } from '@alga-psa/ui';
import { StopwatchProvider } from '@alga-psa/scheduling/providers/StopwatchProvider';
import { MspClientTagsProvider } from '@alga-psa/msp-composition/clients/MspClientTagsProvider';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/** The customer workspace uses only customer-facing destinations. The consent
 * and capability boundaries wrap this component before it mounts. */
export default function CoManagedCustomerShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation('msp/core');
  const [passwordState, setPasswordState] = useState<'checking' | 'required' | 'ready' | 'error'>('checking');

  useEffect(() => {
    let live = true;
    getCoManagedPasswordStatus().then(result => {
      if (live) setPasswordState(result.hasResetPassword ? 'ready' : 'required');
    }).catch(() => { if (live) setPasswordState('error'); });
    return () => { live = false; };
  }, []);

  if (passwordState === 'checking') return <div role="status">{t('coManagedWorkspace.loading', { defaultValue: 'Loading workspace…' })}</div>;
  if (passwordState === 'error') return <div role="alert">{t('coManagedWorkspace.passwordError', { defaultValue: 'Unable to check password status. Please reload this page.' })}</div>;
  if (passwordState === 'required') return <div className="mx-auto max-w-xl p-6">
    <PasswordChangeForm onSuccess={() => setPasswordState('ready')} />
  </div>;

  return <MspClientTagsProvider><DrawerProvider><StopwatchProvider><div className="flex h-screen flex-col">
    <nav aria-label={t('coManagedWorkspace.navigation', { defaultValue: 'Customer workspace' })} className="flex items-center gap-6 border-b px-6 py-4">
      <Link href="/msp/tickets">{t('nav.tickets', { defaultValue: 'Tickets' })}</Link>
      <Link href="/msp/co-managed">{t('nav.coManaged', { defaultValue: 'Co-managed IT' })}</Link>
      <Link href="/msp/knowledge-base">{t('nav.knowledgeBase', { defaultValue: 'Knowledge base' })}</Link>
      <Link href="/msp/co-management/administration">{t('nav.coManagedAdministration', { defaultValue: 'Access & administration' })}</Link>
      <Link href="/msp/profile">{t('nav.profile', { defaultValue: 'Profile' })}</Link>
      <button type="button" onClick={() => void signOut({ callbackUrl: '/auth/msp/signin' })}>{t('nav.signOut', { defaultValue: 'Sign out' })}</button>
    </nav>
    <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
  </div><DrawerOutlet /></StopwatchProvider></DrawerProvider></MspClientTagsProvider>;
}
