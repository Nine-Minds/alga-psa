import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSmtpTransportOptions } from '../../providers/SMTPEmailProvider';
import { buildSmtpOutboundSteps } from '../smtpOutboundSteps';
import type { OutboundDiagnosticsContext } from '../outboundTypes';

const createTransport = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: (...args: unknown[]) => createTransport(...args) },
}));

function makeContext(rawConfig: Record<string, any>): OutboundDiagnosticsContext {
  return {
    tenant: 'tenant-1',
    knex: {} as any,
    settings: {} as any,
    options: { liveSendTest: false, includeIdentifiers: false },
    provider: { providerId: 'smtp-1', providerType: 'smtp', rawConfig },
    liveSend: async () => ({ success: true }),
    checkedCapabilities: [],
  } as any;
}

beforeEach(() => {
  createTransport.mockReset();
});

describe('buildSmtpTransportOptions', () => {
  it('derives secure from the port and defaults rejectUnauthorized to true', () => {
    expect(buildSmtpTransportOptions({ host: 'smtp.example.com', port: 465 }).secure).toBe(true);
    expect(buildSmtpTransportOptions({ host: 'smtp.example.com', port: 587 }).secure).toBe(false);
    expect(buildSmtpTransportOptions({ host: 'smtp.example.com', port: 587 }).options.tls).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('only sends AUTH when both username and password are set', () => {
    expect(buildSmtpTransportOptions({ host: 'h', port: 587, username: 'u' }).authConfigured).toBe(false);
    const withAuth = buildSmtpTransportOptions({ host: 'h', port: 587, username: 'u', password: 'p' });
    expect(withAuth.authConfigured).toBe(true);
    expect(withAuth.options.auth).toEqual({ user: 'u', pass: 'p' });
  });

  it('passes requireTLS through', () => {
    const out = buildSmtpTransportOptions({ host: 'h', port: 587, requireTLS: true });
    expect(out.requireTLS).toBe(true);
    expect(out.options.requireTLS).toBe(true);
  });
});

describe('smtp steps', () => {
  it('fails configuration without host and skips the network attempt', async () => {
    const steps = buildSmtpOutboundSteps();
    const ctx = makeContext({ port: 587, from: 'sender@example.com' });

    const config = steps.find((s) => s.id === 'smtp_configuration')!;
    const connection = steps.find((s) => s.id === 'smtp_connection')!;
    expect((await config.run(ctx)).status).toBe('fail');
    expect((await connection.run(ctx)).status).toBe('skip');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('passes a successful verify and reports unverified TLS/AUTH limitations honestly', async () => {
    const verify = vi.fn(async () => undefined);
    const close = vi.fn();
    createTransport.mockReturnValue({ verify, close });

    const steps = buildSmtpOutboundSteps();
    const ctx = makeContext({ host: 'smtp.example.com', port: 587, from: 'sender@example.com', requireTLS: true });

    expect((await steps.find((s) => s.id === 'smtp_configuration')!.run(ctx)).status).toBe('pass');
    const connection = await steps.find((s) => s.id === 'smtp_connection')!.run(ctx);
    expect(connection.status).toBe('pass');
    expect(connection.data).toMatchObject({ verified: true, combinedVerification: true });
    // TLS was required and the combined verify completed.
    expect((await steps.find((s) => s.id === 'smtp_tls')!.run(ctx)).status).toBe('pass');
    // No credentials configured => AUTH is explicitly not attempted.
    const auth = await steps.find((s) => s.id === 'smtp_auth')!.run(ctx);
    expect(auth.status).toBe('skip');
    expect(close).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('preserves native AUTH failure evidence (code/responseCode/command/response)', async () => {
    createTransport.mockReturnValue({
      verify: vi.fn(async () => {
        throw { code: 'EAUTH', responseCode: 535, command: 'AUTH', response: '535 Authentication failed', message: 'Invalid login' };
      }),
      close: vi.fn(),
    });

    const steps = buildSmtpOutboundSteps();
    const ctx = makeContext({
      host: 'smtp.example.com',
      port: 587,
      from: 'sender@example.com',
      username: 'u',
      password: 'p',
    });

    await steps.find((s) => s.id === 'smtp_configuration')!.run(ctx);
    const connection = await steps.find((s) => s.id === 'smtp_connection')!.run(ctx);
    expect(connection.status).toBe('fail');
    expect(connection.data).toMatchObject({
      phase: 'auth',
      code: 'EAUTH',
      responseCode: 535,
      command: 'AUTH',
      response: '535 Authentication failed',
    });
    expect(connection.error).toMatchObject({ message: 'Invalid login', code: 'EAUTH', status: 535 });

    const auth = await steps.find((s) => s.id === 'smtp_auth')!.run(ctx);
    expect(auth.status).toBe('fail');
    expect(auth.error).toMatchObject({ code: 'EAUTH', status: 535 });
  });

  it('classifies connection refusals and skips later phases', async () => {
    createTransport.mockReturnValue({
      verify: vi.fn(async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:25'), { code: 'ECONNREFUSED' });
      }),
      close: vi.fn(),
    });

    const steps = buildSmtpOutboundSteps();
    const ctx = makeContext({
      host: 'smtp.example.com',
      port: 587,
      from: 'sender@example.com',
      username: 'u',
      password: 'p',
    });

    await steps.find((s) => s.id === 'smtp_configuration')!.run(ctx);
    const connection = await steps.find((s) => s.id === 'smtp_connection')!.run(ctx);
    expect(connection.status).toBe('fail');
    expect(connection.data).toMatchObject({ phase: 'connection', code: 'ECONNREFUSED' });

    expect((await steps.find((s) => s.id === 'smtp_tls')!.run(ctx)).status).toBe('skip');
    const auth = await steps.find((s) => s.id === 'smtp_auth')!.run(ctx);
    expect(auth.status).toBe('skip');
  });
});
