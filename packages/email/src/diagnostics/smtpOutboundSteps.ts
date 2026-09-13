/**
 * SMTP outbound email diagnostics steps.
 *
 * Reuses the same transport configuration as real sending via
 * buildSmtpTransportOptions and performs exactly one verify() attempt. Native
 * transport errors are preserved; stages that a combined verify() cannot
 * independently establish are reported as skip/unverified rather than invented.
 */

import nodemailer from 'nodemailer';
import type { DiagnosticsStepOutcome } from '@alga-psa/shared/services/diagnostics/diagnosticsRunner';
import { buildSmtpTransportOptions } from '../providers/SMTPEmailProvider';
import type {
  OutboundDiagnosticsContext,
  OutboundStepData,
  OutboundStepDefinition,
} from './outboundTypes';

interface SmtpNativeFailure {
  message: string;
  code?: string;
  responseCode?: number;
  command?: string;
  response?: string;
  phase: 'connection' | 'tls' | 'auth' | 'unknown';
}

function classifySmtpFailure(error: any): SmtpNativeFailure {
  const message = error?.message ? String(error.message) : 'SMTP verification failed';
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const responseCode = Number.isFinite(Number(error?.responseCode))
    ? Number(error.responseCode)
    : undefined;
  const command = typeof error?.command === 'string' ? error.command : undefined;
  const response = typeof error?.response === 'string' ? error.response : undefined;

  let phase: SmtpNativeFailure['phase'] = 'unknown';
  if (
    code === 'ETLS' ||
    /certificate|self[- ]signed|tls|ssl/i.test(message)
  ) {
    phase = 'tls';
  } else if (
    code === 'EAUTH' ||
    command === 'AUTH' ||
    (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) ||
    /\b(535|auth|credentials|username|password)\b/i.test(message)
  ) {
    phase = 'auth';
  } else if (
    ['ECONNECTION', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ESOCKET', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(
      code ?? '',
    ) ||
    /connect|connection|refused|timeout|getaddrinfo/i.test(message)
  ) {
    phase = 'connection';
  }

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

export function buildSmtpOutboundSteps(): OutboundStepDefinition[] {
  let verifyOutcome: SmtpNativeFailure | null = null;
  let verificationDurationMs = 0;

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
          return { status: 'skip', detail: 'Skipped because the SMTP configuration is incomplete.' };
        }
        const transport = buildSmtpTransportOptions(config);
        const transporter = nodemailer.createTransport(transport.options);
        const started = Date.now();
        try {
          await transporter.verify();
          verificationDurationMs = Date.now() - started;
          verifyOutcome = null;
          return {
            status: 'pass',
            data: {
              verified: true,
              durationMs: verificationDurationMs,
              // verify() exercises connection, TLS (when required) and AUTH, but
              // does not expose which individual stages were negotiated.
              combinedVerification: true,
            },
          };
        } catch (error: any) {
          verificationDurationMs = Date.now() - started;
          const failure = classifySmtpFailure(error);
          verifyOutcome = failure;
          return {
            status: 'fail',
            data: {
              verified: false,
              durationMs: verificationDurationMs,
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
                    : 'The SMTP verification failed in a phase that could not be isolated; review the native error details.',
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
          };
        }
        if (verifyOutcome?.phase === 'tls') {
          return {
            status: 'fail',
            data: { durationMs: verificationDurationMs, code: verifyOutcome.code ?? null },
            error: { message: verifyOutcome.message, code: verifyOutcome.code },
          };
        }
        if (verifyOutcome) {
          return {
            status: 'skip',
            detail: 'TLS was not reached because the connection/authentication attempt failed earlier.',
          };
        }
        return {
          status: 'pass',
          data: {
            secure: transport.secure,
            requireTLS: transport.requireTLS,
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
          };
        }
        if (verifyOutcome?.phase === 'auth') {
          return {
            status: 'fail',
            data: { durationMs: verificationDurationMs, code: verifyOutcome.code ?? null },
            error: {
              message: verifyOutcome.message,
              code: verifyOutcome.code,
              status: verifyOutcome.responseCode,
            },
          };
        }
        if (verifyOutcome) {
          return {
            status: 'skip',
            detail: 'Authentication was not reached because the connection failed earlier.',
          };
        }
        return {
          status: 'pass',
          data: { authConfigured: true, note: 'Credentials were configured and verify() completed.' },
        };
      },
    },
  ];
}
