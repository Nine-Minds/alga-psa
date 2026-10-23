/**
 * Pure, isomorphic builders for the appointment-request review deep link.
 * No 'use server', Node, DB or React imports: SchedulePage (client) reads the
 * parameter name from here and every producer builds links with the same code.
 */

/** MSP page that reviews appointment requests (SchedulePage). */
export const APPOINTMENT_REQUEST_REVIEW_PATH = '/msp/schedule';

/** Query parameter SchedulePage reads to open and select one request. */
export const APPOINTMENT_REQUEST_ID_PARAM = 'requestId';

/** App-relative deep link, for in-app notification `link` fields. */
export function buildAppointmentRequestReviewPath(appointmentRequestId: string): string {
  if (typeof appointmentRequestId !== 'string' || appointmentRequestId.trim() === '') {
    throw new TypeError('appointmentRequestId is required to build an appointment request review link');
  }
  return `${APPOINTMENT_REQUEST_REVIEW_PATH}?${APPOINTMENT_REQUEST_ID_PARAM}=${encodeURIComponent(appointmentRequestId)}`;
}

/** NEXT_PUBLIC_APP_URL || NEXT_PUBLIC_BASE_URL || 'http://localhost:3000', trailing slashes trimmed. */
export function resolveAppBaseUrl(): string {
  // Referenced statically so Next can inline NEXT_PUBLIC_* in client bundles.
  const raw =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/** Absolute deep link, for email and calendar bodies. */
export function buildAppointmentRequestReviewUrl(
  appointmentRequestId: string,
  baseUrl: string = resolveAppBaseUrl(),
): string {
  return `${baseUrl.replace(/\/+$/, '')}${buildAppointmentRequestReviewPath(appointmentRequestId)}`;
}
