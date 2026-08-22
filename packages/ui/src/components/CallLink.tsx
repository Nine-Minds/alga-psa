'use client';

import React, { createContext, useContext } from 'react';
import { Phone } from 'lucide-react';
import { useTranslation } from '../lib/i18n/client';

/**
 * Click-to-call affordances.
 *
 * `tel:` always works (softphone, desk phone bridge, mobile). The Teams deep
 * link is only offered when the tenant actually has Teams, because a dead
 * teams.microsoft.com link is worse than no link at all.
 */

interface CallLinkContextValue {
  teamsCallEnabled: boolean;
}

const CallLinkContext = createContext<CallLinkContextValue>({ teamsCallEnabled: false });

export function CallLinkProvider({
  teamsCallEnabled,
  children,
}: {
  teamsCallEnabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <CallLinkContext.Provider value={{ teamsCallEnabled }}>{children}</CallLinkContext.Provider>
  );
}

export function useCallLinkContext(): CallLinkContextValue {
  return useContext(CallLinkContext);
}

/** `tel:` target — dialers want digits and a leading '+', nothing else. */
export function buildTelHref(phoneNumber: string | null | undefined): string | null {
  if (typeof phoneNumber !== 'string') return null;
  const trimmed = phoneNumber.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (!digits) return null;
  return `tel:${hasPlus ? '+' : ''}${digits}`;
}

/** Teams PSTN call deep link; `4:` is Teams' phone-number identity prefix. */
export function buildTeamsCallDeepLink(phoneNumber: string | null | undefined): string | null {
  const tel = buildTelHref(phoneNumber);
  if (!tel) return null;
  return `https://teams.microsoft.com/l/call/0/0?users=4:${encodeURIComponent(tel.slice('tel:'.length))}`;
}

export function CallLink({
  phoneNumber,
  id,
  className,
  children,
}: {
  phoneNumber: string | null | undefined;
  id: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation('common');
  const { teamsCallEnabled } = useCallLinkContext();
  const telHref = buildTelHref(phoneNumber);
  const teamsHref = teamsCallEnabled ? buildTeamsCallDeepLink(phoneNumber) : null;

  if (!telHref) {
    return <span className={className}>{children ?? phoneNumber ?? ''}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <a id={id} href={telHref} className="hover:underline">
        {children ?? phoneNumber}
      </a>
      {teamsHref ? (
        <a
          id={`${id}-teams`}
          href={teamsHref}
          target="_blank"
          rel="noreferrer"
          title={t('callLink.teamsCall', { defaultValue: 'Call in Microsoft Teams' })}
          className="text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-primary-600))]"
        >
          <Phone className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </span>
  );
}
