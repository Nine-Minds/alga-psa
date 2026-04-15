'use client';

import React from 'react';
import Schedules from '@alga-psa/workflows/components/automation-hub/Schedules';
import {
  createWorkflowScheduleAction,
  deleteWorkflowScheduleAction,
  getWorkflowScheduleAction,
  listWorkflowScheduleBusinessHoursAction,
  listWorkflowSchedulesAction,
  pauseWorkflowScheduleAction,
  resumeWorkflowScheduleAction,
  updateWorkflowScheduleAction
} from './workflowScheduleServerActions';

const scheduleActions = {
  createWorkflowScheduleAction,
  deleteWorkflowScheduleAction,
  getWorkflowScheduleAction,
  listWorkflowScheduleBusinessHoursAction,
  listWorkflowSchedulesAction,
  pauseWorkflowScheduleAction,
  resumeWorkflowScheduleAction,
  updateWorkflowScheduleAction,
};

export default function WorkflowSchedules() {
  return <Schedules scheduleActions={scheduleActions} />;
}
