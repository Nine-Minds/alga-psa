'use server'

import { z } from 'zod';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import logger from '@alga-psa/core/logger';
import { getAppVersion } from '@/lib/utils/version';

const SUBMISSION_INTERVAL_MS = 60_000;

const vendorSupportRequestSchema = z.object({
  category: z.enum(['bug', 'question', 'billing', 'feature']),
  subject: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(5000),
  pageUrl: z.string().max(2000),
});

export type VendorSupportRequestInput = z.infer<typeof vendorSupportRequestSchema>;

export type VendorSupportRequestError =
  | 'invalid_input'
  | 'rate_limited'
  | 'email_not_configured'
  | 'send_failed';

export type VendorSupportRequestResult =
  | { success: true }
  | { success: false; error: VendorSupportRequestError };

/**
 * One submission per user per minute. In-memory is enough: the limiter only
 * has to stop a user double-submitting the dialog, not defend a public route.
 */
const lastSubmissionByUser = new Map<string, number>();

export const submitVendorSupportRequest = withAuth(async (
  user,
  { tenant },
  input: VendorSupportRequestInput,
): Promise<VendorSupportRequestResult> => {
  const parsed = vendorSupportRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
  }

  const now = Date.now();
  const lastSubmission = lastSubmissionByUser.get(user.user_id);
  if (lastSubmission !== undefined && now - lastSubmission < SUBMISSION_INTERVAL_MS) {
    return { success: false, error: 'rate_limited' };
  }

  // Imported lazily so the email package (and its provider SDKs) stay out of
  // the module graph until a request is actually submitted.
  const { getSystemEmailService, sendVendorSupportRequestEmail } = await import('@alga-psa/email');

  const emailService = await getSystemEmailService();
  if (!(await emailService.isConfigured())) {
    return { success: false, error: 'email_not_configured' };
  }

  const { knex } = await createTenantKnex(tenant);
  const tenantRow = await tenantDb(knex, tenant).table('tenants').first('client_name');

  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username;

  try {
    await sendVendorSupportRequestEmail({
      tenantName: tenantRow?.client_name || 'Unknown',
      tenantId: tenant,
      userName,
      userEmail: user.email,
      category: parsed.data.category,
      subject: parsed.data.subject,
      description: parsed.data.description,
      edition: process.env.NEXT_PUBLIC_EDITION === 'enterprise' ? 'EE' : 'CE',
      isOnPrem: await isSelfHostLicensing().catch(() => false),
      appVersion: getAppVersion(),
      pageUrl: parsed.data.pageUrl,
    });
  } catch (error) {
    logger.error('[submitVendorSupportRequest] Failed to send support request', error);
    return { success: false, error: 'send_failed' };
  }

  lastSubmissionByUser.set(user.user_id, now);

  return { success: true };
});
