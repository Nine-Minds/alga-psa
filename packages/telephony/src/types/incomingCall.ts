import type { CallMatchStatus } from './index';

export type IncomingCallEventKind = 'ringing' | 'connected' | 'ended';

export interface IncomingCallTicket {
  id: string;
  number: string;
  title: string;
  status: string | null;
}

export interface IncomingCallInteraction {
  id: string;
  type: string | null;
  title: string;
  date: string;
}

export interface IncomingCallContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface IncomingCallClient {
  id: string;
  name: string;
}

/** Realtime payload for a ringing call; `connected`/`ended` carry only the identity fields. */
export interface IncomingCallPayload {
  callId: string;
  participantId: string;
  dn: string;
  number?: string | null;
  numberE164?: string | null;
  callerName?: string | null;
  matchStatus?: CallMatchStatus;
  contact?: IncomingCallContact | null;
  client?: IncomingCallClient | null;
  tickets?: IncomingCallTicket[];
  interactions?: IncomingCallInteraction[];
  at?: string;
}

export interface IncomingCallMessage {
  event: IncomingCallEventKind;
  call: IncomingCallPayload;
}

/** What the Yjs `incomingCall` map (and the hook) hands to the card. */
export interface IncomingCallEntry extends IncomingCallMessage {
  receivedAt: string;
}

export const TELEPHONY_INCOMING_CALL_MESSAGE_TYPE = 'telephony.incoming_call';
