import { readFileSync } from 'node:fs';
const stager = await import('../../shared/services/email/inboundEmailSourceStager');
const parsed = await stager.parseStagedMimeIntoEmailDetails({
  tenant: '00000000-0000-0000-0000-000000000001', providerId: '00000000-0000-0000-0000-000000000002',
  providerType: 'imap', rawMime: readFileSync(process.env.SMOKE_EML!),
  fallbackProviderMessageId: 'probe', mailbox: 'helpdesk@browsertest.test', uidValidity: '1', uid: 1 });
console.log('HEADER KEYS:', JSON.stringify(Object.keys((parsed.emailData as any).headers ?? {})));
console.log('AUTH-RESULTS:', JSON.stringify((parsed.emailData as any).headers?.['authentication-results']));
