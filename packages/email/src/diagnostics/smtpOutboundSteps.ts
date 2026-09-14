/**
 * SMTP outbound email diagnostics steps.
 *
 * Reuses the same transport configuration as real sending via
 * buildSmtpTransportOptions and performs exactly one verify() attempt. Native
 * transport errors are preserved; connection/TLS/AUTH are reported from the
 * actual verify outcome, and phases a combined verify() cannot independently
 * establish are reported as skip rather than invented.
 */

import nodemailer from 'nodemailer';
import type { DiagnosticsStepOutcome } from '@alga-psa/shared/services/diagnostics/diagnosticsRunner';
import { buildSmtpTransportOptions } from '../providers/SMTPEmailProvider';
import type {
  OutboundDiagnosticsContext,
  OutboundStepData,
  OutboundStepDefinition,
} from './outboundTypes';

type SmtpPhase = 'connection' | 'tls' | 'auth' | 'unknown';

interface SmtpNativeFailure {
  message: string;
  code?: string;
  responseCode?: number;
  command?: string;
  response?: string;
  phase: SmtpPhase;
}

type VerifyState =
  | { kind: 'not-attempted' }
  | { kind: 'succeeded'; durationMs: number }
  | { kind: 'failed'; failure: SmtpNativeFailure; durationMs: number };

/**
 * Classify a native nodemailer error into the phase it actually failed in.
 * A 5xx response is NOT automatically an AUTH failure: the reported command and
 * error code decide, so a post-AUTH 5xx (e.g. MAIL FROM rejection) is not
 * mislabeled as authentication.
 */
function classifySmtpFailure(error: any): SmtpNativeFailure {
  const message = error?.message ? String(error.message) : 'SMTP verification failed';
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const responseCode = Number.isFinite(Number(error?.responseCode))
    ? Number(error.responseCode)
    : undefined;
  const command = typeof error?.command === 'string' ? error.command.toUpperCase() : undefined;
  const response = typeof error?.response === 'string' ? error.response : undefined;

  const tlsFailure =
    code === 'ETLS' || /certificate|self[- ]signed|\btls\b|\bssl\b/i.test(message);
  const authFailure =
    code === 'EAUTH' ||
    command === 'AUTH' ||
    responseCode === 535 ||
    /\b(535|auth|credentials|invalid login|username|password)\b/i.test(message);
  const connectionFailure =
    ['ECONNECTION', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ESOCKET', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(
      code ?? '',
    ) || /connect|connection|refused|timeout|getaddrinfo|greeting/i.test(message);

  let phase: SmtpPhase = 'unknown';
  if (tlsFailure) phase = 'tls';
  else if (authFailure) phase = 'auth';
  else if (connectionFailure) phase = 'connection';

  return { message, code, responseCode, command, response, phase };
}

function smtpConfigProblems(config: Record<string, any>): string[] {
  const problems: string[] = [];
  if (!config?.host) problems.push('host');
  if (!config?.port) problems.push('port');
  if (!config?.from) problems.push('from');
  const hasUsername = Boolean(config?.username);
  const hasPassword = Boolean(config?.password);
  if (hasUsername !== hasPassword) {
    problems.push('username/password (both must be set together, or both omitted)');
  }
  return problems;
}

function notAttemptedDetail(reason: string): string {
  return `Skipped: verify() was not attempted because ${reason}.`;
}

export function buildSmtpOutboundSteps(): OutboundStepDefinition[] {
  let verifyState: VerifyState = { kind: 'not-attempted' };

  return [
    {
      id: 'smtp_configuration',
      title: 'SMTP configuration',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const config = ctx.provider.rawConfig;
        const transport = buildSmtpTransportOptions(config);
        ctx.checkedCapabilities.push('smtp_configuration');
        if (transport.authConfigured) ctx.checkedCapabilities.push('smtp_auth_configured');
        const problems = smtpConfigProblems(config);
        if (problems.length > 0) {
          return {
            status: 'fail',
            data: { missingOrInvalid: problems },
            error: { message: `Invalid SMTP configuration: ${problems.join(', ')}` },
            recommendations: ['Complete the required SMTP fields (host, port, and From address) before testing.'],
          };
        }
        return {
          status: 'pass',
          data: {
            host: config.host,
            port: transport.options.port,
            secure: transport.secure,
            requireTLS: transport.requireTLS,
            authConfigured: transport.authConfigured,
          },
        };
      },
    },
    {
      id: 'smtp_connection',
      title: 'SMTP verify() (connection / TLS / AUTH attempt)',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const config = ctx.provider.rawConfig;
        if (smtpConfigProblems(config).length > 0) {
          verifyState = { kind: 'not-attempted' };
          return {
            status: 'skip',
            detail: 'Skipped because the SMTP configuration is incomplete.',
            data: { attempted: false },
          };
        }
        const transport = buildSmtpTransportOptions(config);
        const transporter = nodemailer.createTransport(transport.options);
        const started = Date.now();
        try {
          await transporter.verify();
          const durationMs = Date.now() - started;
          verifyState = { kind: 'succeeded', durationMs };
          return {
            status: 'pass',
            data: {
              attempted: true,
              verified: true,
              durationMs,
              // verify() exercises connection, TLS (when required) and AUTH, but
              // does not expose which individual stages were negotiated.
              combinedVerification: true,
            },
          };
        } catch (error: any) {
          const durationMs = Date.now() - started;
          const failure = classifySmtpFailure(error);
          verifyState = { kind: 'failed', failure, durationMs };
          return {
            status: 'fail',
            data: {
              attempted: true,
              verified: false,
              durationMs,
              phase: failure.phase,
              code: failure.code ?? null,
              responseCode: failure.responseCode ?? null,
              command: failure.command ?? null,
              response: failure.response ?? null,
            },
            error: {
              message: failure.message,
              code: failure.code,
              status: failure.responseCode,
            },
            recommendations: [
              failure.phase === 'connection'
                ? 'The SMTP server could not be reached from AlgaPSA. Verify host, port, DNS, and firewall rules.'
                : failure.phase === 'tls'
                  ? 'The TLS handshake failed. Verify the certificate chain and TLS settings (including verify-certificate).'
                  : failure.phase === 'auth'
                    ? 'SMTP authentication failed. Verify the username/password and that AUTH is permitted.'
                    : 'The SMTP verification failed in a phase that could not be isolated; review the native error details (command/response).',
            ],
          };
        } finally {
          transporter.close();
        }
      },
    },
    {
      id: 'smtp_tls',
      title: 'SMTP TLS negotiation',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const config = ctx.provider.rawConfig;
        const transport = buildSmtpTransportOptions(config);
        const tlsRequested = transport.secure || transport.requireTLS;
        if (!tlsRequested) {
          return {
            status: 'skip',
            detail: 'TLS was not explicitly required, so TLS negotiation was not established by this verification.',
            data: { tlsRequested: false, attempted: false },
          };
        }
        if (verifyState.kind === 'failed' && verifyState.failure.phase === 'tls') {
          return {
            status: 'fail',
            data: { durationMs: verifyState.durationMs, code: verifyState.failure.code ?? null },
            error: { message: verifyState.failure.message, code: verifyState.failure.code },
          };
        }
        if (verifyState.kind === 'failed' && verifyState.failure.phase === 'auth') {
          // AUTH is only reached after a successful TLS upgrade, so a required
          // TLS connection that later failed at AUTH did negotiate TLS. This is
          // supported evidence, unlike a connection/unknown failure where TLS
          // may never have been attempted.
          return {
            status: 'pass',
            data: {
              attempted: true,
              secure: transport.secure,
              requireTLS: transport.requireTLS,
              durationMs: verifyState.durationMs,
              note: 'TLS was required and verification advanced to AUTH, so the TLS handshake completed; AUTH failed separately.',
            },
          };
        }
        if (verifyState.kind === 'failed') {
          return {
            status: 'skip',
            detail: 'TLS negotiation was not established by the failed verification.',
            data: { attempted: false, durationMs: verifyState.durationMs },
          };
        }
        if (verifyState.kind === 'not-attempted') {
          return {
            status: 'skip',
            detail: notAttemptedDetail('the SMTP configuration is incomplete'),
            data: { attempted: false },
          };
        }
        return {
          status: 'pass',
          data: {
            attempted: true,
            secure: transport.secure,
            requireTLS: transport.requireTLS,
            durationMs: verifyState.durationMs,
            note: 'TLS was required and the verification handshake completed.',
          },
        };
      },
    },
    {
      id: 'smtp_auth',
      title: 'SMTP authentication',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const config = ctx.provider.rawConfig;
        const transport = buildSmtpTransportOptions(config);
        if (!transport.authConfigured) {
          return {
            status: 'skip',
            detail: 'No SMTP credentials are configured; AUTH was not attempted.',
            data: { authConfigured: false, attempted: false },
          };
        }
        if (verifyState.kind === 'failed' && verifyState.failure.phase === 'auth') {
          return {
            status: 'fail',
            data: { durationMs: verifyState.durationMs, code: verifyState.failure.code ?? null },
            error: {
              message: verifyState.failure.message,
              code: verifyState.failure.code,
              status: verifyState.failure.responseCode,
            },
          };
        }
        if (verifyState.kind === 'failed') {
          const phase = verifyState.failure.phase;
          const detail =
            phase === 'connection'
              ? 'Skipped: authentication was not reached because the connection failed earlier.'
              : phase === 'tls'
                ? 'Skipped: authentication was not reached because TLS failed earlier.'
                : 'Skipped: authentication could not be reached or verified because the failed phase could not be isolated.';
          return {
            status: 'skip',
            detail,
            data: { attempted: false, phase, durationMs: verifyState.durationMs },
          };
        }
        if (verifyState.kind === 'not-attempted') {
          return {
            status: 'skip',
            detail: notAttemptedDetail('the SMTP configuration is incomplete'),
            data: { attempted: false },
          };
        }
        return {
          status: 'pass',
          data: {
            attempted: true,
            authConfigured: true,
            durationMs: verifyState.durationMs,
            note: 'Credentials were configured and verify() completed.',
          },
        };
      },
    },
  ];
}
