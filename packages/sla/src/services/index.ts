/**
 * @alga-psa/sla - Services
 *
 * Core SLA services for timer management, business hours calculations,
 * and pause handling.
 */

// Business hours calculation utilities
export {
  isWithinBusinessHours,
  getNextBusinessHoursStart,
  calculateElapsedBusinessMinutes,
  calculateDeadline,
  getRemainingBusinessMinutes,
  formatRemainingTime,
  type BusinessTimeResult
} from './businessHoursCalculator';

// Main SLA lifecycle service
export {
  startSlaForTicket,
  recordFirstResponse,
  recordResolution,
  getSlaStatus,
  handlePriorityChange,
  type StartSlaResult,
  type RecordSlaEventResult
} from './slaService';

// SLA pause/resume service
export {
  pauseSla,
  resumeSla,
  handleStatusChange,
  handleResponseStateChange,
  shouldSlaBePaused,
  syncPauseState,
  getPauseStats,
  type PauseResult
} from './slaPauseService';

// SLA notification service
export {
  sendSlaNotification,
  sendSlaResponseMetNotification,
  sendSlaResolutionMetNotification,
  checkAndSendThresholdNotifications,
  type SlaNotificationContext,
  type NotificationResult
} from './slaNotificationService';

// ITIL SLA auto-configuration service
export {
  createItilStandardSlaPolicy,
  assignSlaPolicyToBoard,
  configureItilSlaForBoard,
  type CreateItilSlaPolicyResult
} from './itilSlaService';

// Escalation service
export {
  escalateTicket,
  getEscalationManagerForTicket,
  checkEscalationNeeded,
  type EscalationResult
} from './escalationService';
