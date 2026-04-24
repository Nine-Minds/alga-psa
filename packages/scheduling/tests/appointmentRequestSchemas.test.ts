import { describe, expect, it } from 'vitest';
import { approveAppointmentRequestSchema } from '../src/schemas/appointmentRequestSchemas';

describe('approveAppointmentRequestSchema', () => {
  const baseInput = {
    appointment_request_id: '11111111-1111-4111-8111-111111111111',
    assigned_user_id: '22222222-2222-4222-8222-222222222222',
  };

  it('accepts generate_teams_meeting=true, false, and omission with a default of false', () => {
    expect(
      approveAppointmentRequestSchema.parse({
        ...baseInput,
        generate_teams_meeting: true,
      }).generate_teams_meeting
    ).toBe(true);

    expect(
      approveAppointmentRequestSchema.parse({
        ...baseInput,
        generate_teams_meeting: false,
      }).generate_teams_meeting
    ).toBe(false);

    expect(
      approveAppointmentRequestSchema.parse(baseInput).generate_teams_meeting
    ).toBe(false);
  });
});
