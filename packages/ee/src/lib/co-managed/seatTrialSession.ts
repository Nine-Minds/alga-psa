import type { Knex } from 'knex';

// CE does not provision hosted trial sessions.
export async function admitSeatTrialSession(_tenant: string, _userId: string, _sessionId: string): Promise<boolean> {
  return true;
}

export async function admitSeatTrialCredential(_tenant: string, _userId: string, _db: Knex): Promise<boolean> {
  return true;
}
