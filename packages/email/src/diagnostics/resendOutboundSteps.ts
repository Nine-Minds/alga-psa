/**
 * Resend outbound email diagnostics steps.
 *
 * Thin and truthful: validates required configuration and runs the provider's
 * real domains verification (GET /domains) with the cache bypassed for an
 * explicit diagnostic. A restricted key's domains denial is reported as a
 * domains-check denial, not as proof that sending is forbidden.
 */

import axios from 'axios';
import type { DiagnosticsStepOutcome } from '@alga-psa/shared/services/diagnostics/diagnosticsRunner';
import type {
  OutboundStepData,
  OutboundStepDefinition,
} from './outboundTypes';

function extractResendRequestId(headers: Record<string, any> | undefined): string | undefined {
  if (!headers) return undefined;
  const value =
    headers['x-request-id'] ??
    headers['request-id'] ??
    headers['resend-request-id'] ??
    headers['request_id'];
  return typeof value === 'string' ? value : undefined;
}

export function buildResendOutboundSteps(): OutboundStepDefinition[] {
  return [
    {
      id: 'resend_configuration',
      title: 'Resend settings',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const apiKey = ctx.provider.rawConfig?.apiKey ?? ctx.provider.rawConfig?.api_key;
        ctx.checkedCapabilities.push('resend_configuration');
        if (!apiKey || typeof apiKey !== 'string') {
          return {
            status: 'fail',
            error: { message: 'Resend API key is not configured.' },
            recommendations: ['Set the Resend API key in outbound email settings.'],
          };
        }
        return {
          status: 'pass',
          data: {
            apiKeyConfigured: true,
            baseUrl: ctx.provider.rawConfig?.baseUrl ?? ctx.provider.rawConfig?.base_url ?? 'https://api.resend.com',
          },
        };
      },
    },
    {
      id: 'resend_domains_check',
      title: 'Resend connection',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const apiKey = ctx.provider.rawConfig?.apiKey ?? ctx.provider.rawConfig?.api_key;
        if (!apiKey || typeof apiKey !== 'string') {
          return { status: 'skip', detail: 'Skipped because the Resend API key is not configured.' };
        }
        const baseUrl = ctx.provider.rawConfig?.baseUrl ?? ctx.provider.rawConfig?.base_url ?? 'https://api.resend.com';
        ctx.checkedCapabilities.push('resend_domains');
        const client = axios.create({
          baseURL: baseUrl,
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 30000,
        });
        try {
          const response = await client.get('/domains');
          const domains = Array.isArray(response.data?.data) ? response.data.data : response.data;
          return {
            status: 'pass',
            http: {
              method: 'GET',
              path: '/domains',
              status: response.status,
              requestId: extractResendRequestId(response.headers as Record<string, any>),
            },
            data: {
              cacheBypassed: true,
              domainCount: Array.isArray(domains) ? domains.length : undefined,
            },
            detail: 'AlgaPSA connected to Resend. Send a test email to check sending from your address.',
          };
        } catch (error: any) {
          const status = error?.response?.status as number | undefined;
          const requestId = extractResendRequestId(error?.response?.headers);
          const message =
            error?.response?.data?.message ||
            error?.message ||
            'Resend domains check failed';
          // A restricted sending key may deny domain access. A 401 is an actual sign-in failure.
          const denied = status === 403;
          return {
            status: denied ? 'warn' : 'fail',
            http: {
              method: 'GET',
              path: '/domains',
              status,
              requestId,
            },
            detail: denied
              ? 'Resend did not allow this check. Some API keys allow sending email without access to domain settings. Send a test email to check sending.'
              : status === 401
                ? 'Resend did not accept the API key. Update it in email settings.'
                : 'AlgaPSA could not complete the Resend connection check.',
            error: { message, status, code: status ? String(status) : undefined, requestId },
            data: { cacheBypassed: true, denied },
            recommendations: denied
              ? []
              : status === 401
                ? ['Update the Resend API key in email settings.']
                : ['Check the Resend API key in email settings. If it is correct, ask your administrator to check AlgaPSA’s connection to Resend.'],
          };
        }
      },
    },
  ];
}
