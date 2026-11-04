import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

/**
 * APPOINTMENT_REQUEST_APPROVED / DECLINED (payload.AppointmentRequest*.v1). CREATED and CANCELLED are catalogued but nothing emits them yet (no-product-emitter in the registry), so they have no builder.
 * Database columns arrive as `null` for absent values; the schema's optional fields reject `null`,
 * so those are dropped here. `requesterName` / `requesterPhone` are nullable in the schema and pass through.
 */
export type AppointmentRequestEventParams = {
  appointmentRequestId: string;
  serviceId: string;
  serviceName: string;
  requestedDate: string;
  requestedTime: string;
  requestedDuration: number;
  isAuthenticated: boolean;
  requesterEmail: string;
  requesterName?: string | null;
  requesterPhone?: string | null;
  clientId?: string | null;
  contactId?: string | null;
  clientUserId?: string | null;
  preferredAssignedUserId?: string | null;
  companyName?: string | null;
  ticketId?: string | null;
  description?: string | null;
  approvedByUserId?: string | null;
  assignedUserId?: string | null;
  scheduleEntryId?: string | null;
  declineReason?: string | null;
};

const OPTIONAL_FIELDS = [
  'clientId',
  'contactId',
  'clientUserId',
  'preferredAssignedUserId',
  'companyName',
  'ticketId',
  'description',
  'approvedByUserId',
  'assignedUserId',
  'scheduleEntryId',
  'declineReason',
] as const;

function appointmentRequestPayload(params: AppointmentRequestEventParams): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    appointmentRequestId: params.appointmentRequestId,
    serviceId: params.serviceId,
    serviceName: params.serviceName,
    requestedDate: params.requestedDate,
    requestedTime: params.requestedTime,
    requestedDuration: params.requestedDuration,
    isAuthenticated: params.isAuthenticated,
    requesterEmail: params.requesterEmail,
  };
  if (params.requesterName !== undefined) payload.requesterName = params.requesterName;
  if (params.requesterPhone !== undefined) payload.requesterPhone = params.requesterPhone;
  for (const field of OPTIONAL_FIELDS) {
    const value = params[field];
    if (value !== undefined && value !== null) payload[field] = value;
  }
  return payload;
}

export function buildAppointmentRequestApprovedPayload(
  params: AppointmentRequestEventParams
): Record<string, unknown> & BuiltWorkflowPayload<'APPOINTMENT_REQUEST_APPROVED'> {
  return builtWorkflowPayload('APPOINTMENT_REQUEST_APPROVED', appointmentRequestPayload(params));
}

export function buildAppointmentRequestDeclinedPayload(
  params: AppointmentRequestEventParams
): Record<string, unknown> & BuiltWorkflowPayload<'APPOINTMENT_REQUEST_DECLINED'> {
  return builtWorkflowPayload('APPOINTMENT_REQUEST_DECLINED', appointmentRequestPayload(params));
}
