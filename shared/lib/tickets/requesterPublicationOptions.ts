import { TicketConversationError, conversationUuid } from './namedConversations';

/** Explicit human publication intent, separate from generated message content. */
export interface RequesterPublicationOptions {
  isResolution?: true;
  close?: { statusId: string; overrideReason?: string };
  schedule?: { at: string; timeZone: string };
}
export function snapshotRequesterPublicationOptions(input: unknown): RequesterPublicationOptions | null {
  if (input == null) return null;
  const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };
  if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['isResolution', 'close', 'schedule'].includes(key))) return invalid();
  const options = input as RequesterPublicationOptions;
  if ((options.isResolution !== undefined && options.isResolution !== true) || (!options.isResolution && !options.schedule)) return invalid();
  const result: RequesterPublicationOptions = options.isResolution ? { isResolution: true } : {};
  if (options.schedule !== undefined) {
    const schedule = options.schedule;
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule) || Object.keys(schedule).some(key => !['at', 'timeZone'].includes(key)) ||
      typeof schedule.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(schedule.at) ||
      !Number.isFinite(Date.parse(schedule.at)) || new Date(schedule.at).toISOString() !== schedule.at ||
      typeof schedule.timeZone !== 'string' || !schedule.timeZone || schedule.timeZone.length > 64) return invalid();
    try { Intl.DateTimeFormat(undefined, { timeZone: schedule.timeZone }); } catch { return invalid(); }
    result.schedule = { at: schedule.at, timeZone: schedule.timeZone };
  }
  if (options.close !== undefined) {
    const close = options.close;
    if (!options.isResolution || options.schedule || !close || typeof close !== 'object' || Array.isArray(close) || !conversationUuid(close.statusId) ||
      Object.keys(close).some(key => !['statusId', 'overrideReason'].includes(key)) ||
      (close.overrideReason !== undefined && (typeof close.overrideReason !== 'string' || close.overrideReason.length > 4000 || close.overrideReason.includes('\0')))) return invalid();
    result.close = { statusId: close.statusId.toLowerCase(), ...(close.overrideReason !== undefined ? { overrideReason: close.overrideReason } : {}) };
  }
  return result;
}
