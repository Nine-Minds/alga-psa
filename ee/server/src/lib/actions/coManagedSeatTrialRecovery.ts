'use server';
import { withAuth } from '@alga-psa/auth';
import { canDiscoverSeatTrial } from '../co-managed/seatTrialDiscovery';

export const hasSeatTrialRecoveryAction = withAuth(async (user, { tenant }, clientId: string) =>
  canDiscoverSeatTrial(user, tenant, clientId));
