import type { SmartTicketSearchErrorBody } from '@alga-psa/tickets/lib/smartTicketSearch/types';

export const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

export function eeUnavailable(): Response {
  const body: SmartTicketSearchErrorBody = {
    code: 'ENTERPRISE_EDITION_REQUIRED',
    error: 'Smart ticket search is only available in Enterprise Edition',
  };
  return new Response(JSON.stringify(body), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
