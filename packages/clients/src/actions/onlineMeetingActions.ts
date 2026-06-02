'use server'

import type { IOnlineMeeting } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import OnlineMeetingModel from '../models/onlineMeeting';

export const getOnlineMeetingForInteraction = withAuth(async (
  _user,
  { tenant },
  interactionId: string,
): Promise<IOnlineMeeting | null> => {
  if (!interactionId) {
    throw new Error('Interaction ID is required');
  }

  return await OnlineMeetingModel.getByInteractionId(interactionId, tenant);
});
