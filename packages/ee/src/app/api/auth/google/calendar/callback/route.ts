import { unavailableCalendarResponse } from '../../../../../../lib/calendarStubs';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return unavailableCalendarResponse();
}
