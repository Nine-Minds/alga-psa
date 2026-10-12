import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_CODE_VALUES,
  NOOP_INBOUND_EMAIL_METRICS_SINK,
  installInboundEmailMetricsSink,
  normalizeAuthCode,
  normalizeImapListenerErrorReason,
  normalizeMessageOutcome,
  normalizeMessageReason,
  normalizePauseReason,
  normalizeProviderType,
  normalizeQueue,
  normalizeQueueJobOutcome,
  observeQueueJobDuration,
  recordAuthFailure,
  recordAutoPause,
  recordConsumerLoopError,
  recordImapListenerError,
  recordImapOauthAuthRetry,
  recordImapWebhookDispatchRetry,
  recordMessageOutcome,
  recordQueueJobOutcome,
  resetInboundEmailMetricsSinkForTests,
  type InboundEmailMetricsSink,
} from '../inboundEmailMetrics';

const UUID = '3f2b8c1e-9a4d-4e57-8b21-0c6d5a7e1f90';
const ADVERSARIAL = [UUID, 'user@example.com', 'ECONNREFUSED 10.0.0.1:993', '', null, undefined, 42, {}];

function recordingSink(): InboundEmailMetricsSink & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    queueJob: (e) => calls.push(['queueJob', e]),
    jobDuration: (e) => calls.push(['jobDuration', e]),
    message: (e) => calls.push(['message', e]),
    authFailure: (e) => calls.push(['authFailure', e]),
    autoPaused: (e) => calls.push(['autoPaused', e]),
    imapListenerError: (e) => calls.push(['imapListenerError', e]),
    imapWebhookDispatchRetry: () => calls.push(['imapWebhookDispatchRetry', null]),
    imapOauthAuthRetry: () => calls.push(['imapOauthAuthRetry', null]),
    consumerLoopError: (e) => calls.push(['consumerLoopError', e]),
  };
}

afterEach(() => resetInboundEmailMetricsSinkForTests());

describe('inboundEmailMetrics', () => {
  it('never throws with the default no-op sink', () => {
    expect(() => {
      recordQueueJobOutcome({ queue: 'v1', providerType: 'imap', outcome: 'ack' });
      observeQueueJobDuration({ queue: 'v1', providerType: 'imap', seconds: 1 });
      recordMessageOutcome({ providerType: 'imap', outcome: 'created' });
      recordAuthFailure({ providerType: 'microsoft', code: 'microsoft:invalid_client' });
      recordAutoPause({ providerType: 'microsoft', code: 'microsoft:invalid_client' });
      recordImapListenerError({ reason: 'auth' });
      recordImapWebhookDispatchRetry();
      recordImapOauthAuthRetry();
      recordConsumerLoopError({ queue: 'v1' });
    }).not.toThrow();
    expect(NOOP_INBOUND_EMAIL_METRICS_SINK.queueJob).toBeTypeOf('function');
  });

  it('delivers normalized labels to an installed sink', () => {
    const sink = recordingSink();
    installInboundEmailMetricsSink(sink);
    recordQueueJobOutcome({ queue: 'v2', providerType: 'Microsoft', outcome: 'defer' });
    recordMessageOutcome({ providerType: UUID, outcome: 'created', reason: 'source_unavailable:ECONNRESET' });
    recordAuthFailure({ providerType: 'google', code: 'google:invalid_grant:bad_subtype' });
    recordAutoPause({ providerType: 'imap', code: 'weird' });
    expect(sink.calls).toEqual([
      ['queueJob', { queue: 'v2', providerType: 'microsoft', outcome: 'defer' }],
      ['message', { providerType: 'other', outcome: 'created', reason: 'source_unavailable' }],
      ['authFailure', { providerType: 'google', code: 'google:invalid_grant' }],
      ['autoPaused', { providerType: 'imap', code: 'other' }],
    ]);
  });

  it('ignores invalid durations', () => {
    const sink = recordingSink();
    installInboundEmailMetricsSink(sink);
    observeQueueJobDuration({ queue: 'v1', seconds: Number.NaN });
    observeQueueJobDuration({ queue: 'v1', seconds: -1 });
    expect(sink.calls).toEqual([]);
  });

  it('swallows errors thrown by the sink', () => {
    const boom = () => {
      throw new Error('sink exploded');
    };
    installInboundEmailMetricsSink({
      queueJob: boom,
      jobDuration: boom,
      message: boom,
      authFailure: boom,
      autoPaused: boom,
      imapListenerError: boom,
      imapWebhookDispatchRetry: boom,
      imapOauthAuthRetry: boom,
      consumerLoopError: boom,
    });
    expect(() => {
      recordQueueJobOutcome({ queue: 'v1', outcome: 'ack' });
      observeQueueJobDuration({ queue: 'v1', seconds: 1 });
      recordMessageOutcome({ outcome: 'created' });
      recordAuthFailure({});
      recordAutoPause({});
      recordImapListenerError({});
      recordImapWebhookDispatchRetry();
      recordImapOauthAuthRetry();
      recordConsumerLoopError({ queue: 'v1' });
    }).not.toThrow();
  });

  it('maps unknown, tenant-like or free-text input to a bounded fallback', () => {
    for (const bad of ADVERSARIAL) {
      expect(normalizeProviderType(bad)).toBe('other');
      expect(normalizeMessageReason(bad === '' || bad == null ? 'x' : bad)).toBe('other');
      expect(normalizeAuthCode(bad)).toBe('other');
      expect(normalizePauseReason(bad)).toBe('other');
      expect(normalizeImapListenerErrorReason(bad)).toBe('other');
      expect(normalizeQueueJobOutcome(bad)).toBe('skip');
      expect(normalizeMessageOutcome(bad)).toBe('skipped');
      expect(normalizeQueue(bad)).toBe('v1');
    }
  });

  it('reduces source_unavailable:<detail> and collapses google/imap subtypes', () => {
    expect(normalizeMessageReason('source_unavailable:fetch failed for a@b.com')).toBe('source_unavailable');
    expect(normalizeMessageReason(undefined)).toBe('none');
    expect(normalizeAuthCode('google:invalid_grant:account_disabled')).toBe('google:invalid_grant');
    expect(normalizeAuthCode('imap:invalid_client:whatever')).toBe('imap:invalid_client');
    expect(normalizeAuthCode('microsoft:invalid_grant:aadsts50173')).toBe('microsoft:invalid_grant:aadsts50173');
    expect(normalizeAuthCode('microsoft:invalid_client:subtype')).toBe('other');
    for (const code of AUTH_CODE_VALUES) expect(normalizeAuthCode(code)).toBe(code);
  });

  it('does not call the sink with raw values (spy)', () => {
    const queueJob = vi.fn();
    installInboundEmailMetricsSink({ ...NOOP_INBOUND_EMAIL_METRICS_SINK, queueJob });
    recordQueueJobOutcome({ queue: UUID, providerType: 'a@b.com', outcome: 'nonsense' });
    expect(queueJob).toHaveBeenCalledWith({ queue: 'v1', providerType: 'other', outcome: 'skip' });
  });
});
