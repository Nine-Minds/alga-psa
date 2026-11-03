'use server'

import type { IOnlineMeetingView } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import OnlineMeetingModel from '../models/onlineMeeting';
import { interactionSeam, resolveInteractionBrowserActor } from '../lib/coManagedInteractionReader';
import { assertMspPermission } from '../lib/authHelpers';

export const getOnlineMeetingForInteraction = withAuth(async (
  user,
  { tenant },
  interactionId: string,
): Promise<IOnlineMeetingView | null> => {
  if (!interactionId) {
    throw new Error('Interaction ID is required');
  }

  await assertMspPermission(user, 'interaction', 'read', 'Forbidden');

  const admitted = await interactionSeam.delegate(tenant, async provider => {
    const { knex } = await createTenantKnex();
    return provider.readInteractionMeeting(knex, tenant, interactionId, () => resolveInteractionBrowserActor(user, tenant));
  });
  if (admitted.handled) return admitted.meeting;

  return await OnlineMeetingModel.getByInteractionId(interactionId, tenant);
});

// `refreshMeetingRecordings` now lives in @alga-psa/scheduling/actions (it needs EE Microsoft
// Graph access, which clients must not depend on). The clients UI reaches it through the
// ClientCrossFeature context.
