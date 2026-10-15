import { actionError } from '@alga-psa/ui/lib/errorHandling';
import { TimeSheetResolutionError } from '../../actions/timeSheetActionErrors';
import type { StopwatchSessionView } from './stopwatchTypes';

/**
 * Expected stopwatch failures. They extend TimeSheetResolutionError, so
 * `timeSheetActionErrorFrom` hands the carried, localizable error straight back and callers
 * (server actions, API services) need no new mapping. Throwing keeps caller-owned
 * transactions rolling back.
 */
export type StopwatchErrorKind =
  | 'notFound'
  | 'notOpen'
  | 'workItemNotFound'
  | 'unsupportedWorkItem'
  | 'boardDisabled'
  | 'serviceRequired';

const MESSAGES: Record<StopwatchErrorKind, { message: string; key: string }> = {
  notFound: {
    message: 'Stopwatch session not found. It may already have been logged or discarded. Please refresh.',
    key: 'msp/time-entry:errors.stopwatch.notFound',
  },
  notOpen: {
    message: 'This stopwatch session is already closed.',
    key: 'msp/time-entry:errors.stopwatch.notOpen',
  },
  workItemNotFound: {
    message: 'The work item for this stopwatch could not be found.',
    key: 'msp/time-entry:errors.stopwatch.workItemNotFound',
  },
  unsupportedWorkItem: {
    message: 'The stopwatch can only be started on tickets and project tasks.',
    key: 'msp/time-entry:errors.stopwatch.unsupportedWorkItem',
  },
  boardDisabled: {
    message: "The stopwatch is turned off for this ticket's board.",
    key: 'msp/time-entry:errors.stopwatch.boardDisabled',
  },
  serviceRequired: {
    message: 'Choose a service before logging this stopwatch session.',
    key: 'msp/time-entry:errors.stopwatch.serviceRequired',
  },
};

export class StopwatchError extends TimeSheetResolutionError {
  readonly kind: StopwatchErrorKind;

  constructor(kind: StopwatchErrorKind) {
    const { message, key } = MESSAGES[kind];
    super(`Stopwatch: ${kind}`, actionError(message, key));
    this.name = 'StopwatchError';
    this.kind = kind;
  }
}

/** Thrown when the user already has an open (running/paused) session. Carries that session. */
export class StopwatchConflictError extends Error {
  readonly openSession: StopwatchSessionView;

  constructor(openSession: StopwatchSessionView) {
    super('An open stopwatch session already exists for this user');
    this.name = 'StopwatchConflictError';
    this.openSession = openSession;
  }
}
