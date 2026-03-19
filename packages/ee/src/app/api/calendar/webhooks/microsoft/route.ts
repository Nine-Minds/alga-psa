import { unavailableCalendarResponse } from '../../../../../lib/calendarStubs';

export async function GET(): Promise<Response> {
  return unavailableCalendarResponse();
}

export async function POST(): Promise<Response> {
  return unavailableCalendarResponse();
}

export async function OPTIONS(): Promise<Response> {
  return unavailableCalendarResponse();
}
