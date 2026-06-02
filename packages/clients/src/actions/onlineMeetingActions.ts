'use server'

import type { IOnlineMeeting } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import OnlineMeetingModel from '../models/onlineMeeting';
import { fetchAndPersistMeetingArtifacts } from '../lib/onlineMeetingArtifactCapture';

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

export const refreshMeetingRecordings = withAuth(async (
  user,
  { tenant },
  meetingId: string,
): Promise<IOnlineMeeting> => {
  if (!meetingId) {
    throw new Error('Meeting ID is required');
  }

  return await fetchAndPersistMeetingArtifacts({
    tenantId: tenant,
    meetingId,
    actorUserId: user.user_id,
  });
});
