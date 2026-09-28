'use client';

import React, { createContext, useContext } from 'react';
import { Phone, PhoneOutgoing } from 'lucide-react';
import { useTranslation } from '../lib/i18n/client';
import { formatPhoneForDisplay, formatPhoneLabel } from '@alga-psa/validation';
import { Tooltip } from './Tooltip';

/**
 * Click-to-call affordances.
 *
 * `tel:` always works (softphone, desk phone bridge, mobile). The Teams deep
 * link is only offered when the tenant actually has Teams, because a dead
 * teams.microsoft.com link is worse than no link at all.
 */

export interface CallIntentTarget {
  ticketId: string;
}

export interface ThreecxCallLinkState {
  connected: boolean;
  extension: string | null;
}

export type PlaceThreecxCall = (
  input: { phoneNumber: string; ticketId?: string | null },
) => void | Promise<void>;

interface CallLinkContextValue {
  teamsCallEnabled: boolean;
  teamsPhoneConnected: boolean;
  recordCallIntent?: (input: CallIntentTarget & { phoneNumber: string }) => void | Promise<void>;
  threecx: ThreecxCallLinkState;
  placeThreecxCall?: PlaceThreecxCall;
}

const NO_THREECX: ThreecxCallLinkState = { connected: false, extension: null };

const CallLinkContext = createContext<CallLinkContextValue>({
  teamsCallEnabled: false,
  teamsPhoneConnected: false,
  threecx: NO_THREECX,
});

export function CallLinkProvider({
  teamsCallEnabled,
  teamsPhoneConnected = false,
  recordCallIntent,
  threecx = NO_THREECX,
  placeThreecxCall,
  children,
}: {
  teamsCallEnabled: boolean;
  teamsPhoneConnected?: boolean;
  recordCallIntent?: CallLinkContextValue['recordCallIntent'];
  threecx?: ThreecxCallLinkState;
  placeThreecxCall?: PlaceThreecxCall;
  children: React.ReactNode;
}) {
  return (
    <CallLinkContext.Provider value={{ teamsCallEnabled, teamsPhoneConnected, recordCallIntent, threecx, placeThreecxCall }}>
      {children}
    </CallLinkContext.Provider>
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
  callIntent,
  extension,
  defaultCountry,
}: {
  phoneNumber: string | null | undefined;
  id: string;
  className?: string;
  children?: React.ReactNode;
  callIntent?: CallIntentTarget;
  extension?: string | null;
  defaultCountry?: string | null;
}) {
  const { t } = useTranslation('common');
  const { teamsCallEnabled, recordCallIntent, threecx, placeThreecxCall } = useCallLinkContext();
  const formatted = formatPhoneForDisplay(phoneNumber, extension, defaultCountry);
  const displayText = formatPhoneLabel(formatted, t('phone.extension', { defaultValue: 'ext.' }));
  const dialPhoneNumber = formatted.e164 || phoneNumber;
  const telHrefBase = buildTelHref(dialPhoneNumber);
  const telHref = telHrefBase && formatted.extension ? `${telHrefBase};ext=${formatted.extension}` : telHrefBase;
  const teamsHref = teamsCallEnabled ? buildTeamsCallDeepLink(dialPhoneNumber) : null;
  const teamsCallLabel = t('callLink.teamsCall', { defaultValue: 'Call in Microsoft Teams' });
  const threecxCallLabel = t('callLink.threecxCall', { defaultValue: 'Call via 3CX' });
  const threecxEnabled = threecx.connected && Boolean(threecx.extension) && Boolean(placeThreecxCall);

  if (!telHref) {
    return <span className={className}>{(children ?? displayText) || phoneNumber || ''}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <a id={id} href={telHref} className="hover:underline">
        {children ?? displayText}
      </a>
      {threecxEnabled ? (
        <Tooltip content={threecxCallLabel}>
          <button
            type="button"
            id={`${id}-threecx`}
            aria-label={threecxCallLabel}
            className="text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-primary-600))]"
            onClick={() => {
              if (phoneNumber) {
                void placeThreecxCall?.({ phoneNumber: dialPhoneNumber ?? phoneNumber, ticketId: callIntent?.ticketId ?? null });
              }
            }}
          >
            <PhoneOutgoing className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      ) : null}
      {teamsHref ? (
        <Tooltip content={teamsCallLabel}>
          <a
            id={`${id}-teams`}
            href={teamsHref}
            target="_blank"
            rel="noreferrer"
            aria-label={teamsCallLabel}
            className="text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-primary-600))]"
            onClick={() => {
              if (callIntent && phoneNumber) {
                void recordCallIntent?.({ ...callIntent, phoneNumber: dialPhoneNumber ?? phoneNumber });
              }
            }}
          >
            <Phone className="h-3.5 w-3.5" />
          </a>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** A labelled Teams-only action, used where a `tel:` link would be ambiguous. */
export function TeamsCallLink({
  phoneNumber,
  id,
  className,
  children,
  callIntent,
}: {
  phoneNumber: string | null | undefined;
  id: string;
  className?: string;
  children?: React.ReactNode;
  callIntent?: CallIntentTarget;
}) {
  const { t } = useTranslation('common');
  const { teamsPhoneConnected, recordCallIntent } = useCallLinkContext();
  const href = teamsPhoneConnected ? buildTeamsCallDeepLink(phoneNumber) : null;
  const teamsCallLabel = t('callLink.teamsCall', { defaultValue: 'Call in Microsoft Teams' });

  if (!href) return null;

  return (
    <Tooltip content={teamsCallLabel}>
      <a
        id={id}
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={teamsCallLabel}
        className={className}
        onClick={() => {
          if (callIntent && phoneNumber) {
            void recordCallIntent?.({ ...callIntent, phoneNumber });
          }
        }}
      >
        {children ?? <Phone className="h-3.5 w-3.5" />}
      </a>
    </Tooltip>
  );
}
