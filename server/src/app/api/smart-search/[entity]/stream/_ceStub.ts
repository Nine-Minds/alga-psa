import type { SmartSearchErrorBody } from '@alga-psa/ui/lib/smartSearch/types';

export const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

export function eeUnavailable(): Response {
  const body: SmartSearchErrorBody = {
    code: 'ENTERPRISE_EDITION_REQUIRED',
    error: 'Smart search is only available in Enterprise Edition',
  };
  return new Response(JSON.stringify(body), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
