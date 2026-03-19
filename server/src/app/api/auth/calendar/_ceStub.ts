import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export const CALENDAR_CALLBACK_UNAVAILABLE_ERROR = 'Calendar sync is only available in Enterprise Edition.';

export const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

export function eeUnavailable(): Response {
  return NextResponse.json(
    {
      success: false,
      error: CALENDAR_CALLBACK_UNAVAILABLE_ERROR,
    },
    {
      status: 501,
    }
  );
}
