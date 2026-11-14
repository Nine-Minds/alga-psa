import { describe, expect, it } from 'vitest';
import { HumanWorkAssigneeInvalidError } from '@alga-psa/shared/lib/humanWork/HumanWorkOwnerRequiredError';
import { ticketActionErrorFrom } from './ticketActionErrors';

describe('ticketActionErrorFrom', () => {
  it('returns a user-safe application error for invalid human-work assignees', () => {
    const result = ticketActionErrorFrom(
      new HumanWorkAssigneeInvalidError(['00000000-0000-4000-8000-000000000000']),
    );

    expect(result).toEqual({
      actionError: 'One or more selected agents cannot be assigned. Choose active internal agents and try again.',
    });
    expect(JSON.stringify(result)).not.toContain('00000000-0000-4000-8000-000000000000');
  });

  it('says a seat technician is out of scope rather than asking for an active internal agent', () => {
    const result = ticketActionErrorFrom(
      new HumanWorkAssigneeInvalidError(['00000000-0000-4000-8000-000000000000'], 'seat_out_of_scope'),
    );

    expect(result).toEqual({
      actionError:
        "This would leave a client IT technician on work outside their scope. Client IT technicians work only on their own client's tickets, on boards shared with them.",
    });
    expect(JSON.stringify(result)).not.toContain('00000000-0000-4000-8000-000000000000');
  });
});
