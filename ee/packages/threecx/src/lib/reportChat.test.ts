import { describe, expect, it } from 'vitest';
import {
  buildThreecxCanonicalChat,
  threecxProviderChatId,
  validateThreecxReportChatBody,
} from './reportChat';
import { THREECX_REPORT_CHAT_POST_KEYS } from './template';

const baseBody = {
  number: '+15551234567',
  email: 'Dorothy@Example.com',
  name: 'Dorothy Gale',
  agentEmail: 'agent@example.com',
  queueExtension: '800',
  durationSeconds: 125,
  startTimeUtc: '2026-09-15T10:00:00Z',
  endTimeUtc: '2026-09-15T10:02:05Z',
  messages: 'Dorothy: hi\nAgent: hello',
  entityId: 'contact-1',
  entityType: 'contact',
};

describe('threecx report-chat mapping', () => {
  it('T091: accepts every documented post key and nothing else is required beyond messages/startTimeUtc', () => {
    const result = validateThreecxReportChatBody(baseBody);
    expect(result.ok).toBe(true);
    for (const key of THREECX_REPORT_CHAT_POST_KEYS) {
      expect(baseBody).toHaveProperty(key);
    }
    const minimal = validateThreecxReportChatBody({ messages: 'hi', startTimeUtc: baseBody.startTimeUtc });
    expect(minimal.ok).toBe(true);
    if (minimal.ok) {
      expect(minimal.value.durationSeconds).toBe(0);
      expect(minimal.value.agentEmail).toBeUndefined();
    }
  });

  it('T145: rejects a body missing messages or startTimeUtc', () => {
    const { messages: _m, ...noMessages } = baseBody;
    const { startTimeUtc: _s, ...noStart } = baseBody;
    expect(validateThreecxReportChatBody(noMessages).ok).toBe(false);
    expect(validateThreecxReportChatBody({ ...baseBody, messages: '   ' }).ok).toBe(false);
    expect(validateThreecxReportChatBody(noStart).ok).toBe(false);
    expect(validateThreecxReportChatBody(null).ok).toBe(false);
  });

  it('T091: rejects non-ISO times and negative durations, tolerates empty optional times', () => {
    expect(validateThreecxReportChatBody({ ...baseBody, startTimeUtc: 'yesterday' }).ok).toBe(false);
    expect(validateThreecxReportChatBody({ ...baseBody, endTimeUtc: 'later' }).ok).toBe(false);
    expect(validateThreecxReportChatBody({ ...baseBody, durationSeconds: -1 }).ok).toBe(false);
    expect(validateThreecxReportChatBody({ ...baseBody, durationSeconds: 'abc' }).ok).toBe(false);
    const empties = validateThreecxReportChatBody({ ...baseBody, endTimeUtc: '', queueExtension: '', durationSeconds: '' });
    expect(empties.ok).toBe(true);
    if (empties.ok) {
      expect(empties.value.endTimeUtc).toBeUndefined();
      expect(empties.value.queueExtension).toBeUndefined();
      expect(empties.value.durationSeconds).toBe(0);
    }
  });

  it('T147: threecxProviderChatId is stable across millisecond differences and email case', () => {
    const a = threecxProviderChatId({ agentEmail: 'Agent@Example.com', number: '+15551234567', email: 'D@x.com', startTimeUtc: '2026-09-15T10:00:00.000Z' });
    const b = threecxProviderChatId({ agentEmail: 'agent@example.com', number: '+15551234567', email: 'd@x.com', startTimeUtc: '2026-09-15T10:00:00.750Z' });
    const c = threecxProviderChatId({ agentEmail: 'agent@example.com', number: '+15551234567', email: 'd@x.com', startTimeUtc: '2026-09-15T10:00:01Z' });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('T147: changing the visitor number or email changes the id', () => {
    const base = threecxProviderChatId({ agentEmail: 'a@x.com', number: '+15551234567', email: 'd@x.com', startTimeUtc: baseBody.startTimeUtc });
    expect(threecxProviderChatId({ agentEmail: 'a@x.com', number: '+15557654321', email: 'd@x.com', startTimeUtc: baseBody.startTimeUtc })).not.toBe(base);
    expect(threecxProviderChatId({ agentEmail: 'a@x.com', number: '+15551234567', email: 'e@x.com', startTimeUtc: baseBody.startTimeUtc })).not.toBe(base);
  });

  it('maps a validated body to the canonical chat with raw equal to the body', () => {
    const validation = validateThreecxReportChatBody(baseBody);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const chat = buildThreecxCanonicalChat(validation.value);
    expect(chat).toMatchObject({
      provider: '3cx',
      agentEmail: 'agent@example.com',
      number: '+15551234567',
      email: 'Dorothy@Example.com',
      name: 'Dorothy Gale',
      queueExtension: '800',
      startedAt: '2026-09-15T10:00:00.000Z',
      endedAt: '2026-09-15T10:02:05.000Z',
      durationSeconds: 125,
      messages: baseBody.messages,
      entityId: 'contact-1',
      entityType: 'contact',
    });
    expect(chat.providerChatId).toBe(threecxProviderChatId({
      agentEmail: baseBody.agentEmail,
      number: baseBody.number,
      email: baseBody.email,
      startTimeUtc: baseBody.startTimeUtc,
    }));
    expect(chat.raw).toEqual(validation.value);
  });
});
