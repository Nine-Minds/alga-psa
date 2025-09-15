/**
 * Standard Change Approval Workflow
 *
 * Handles approval for standard changes, which are pre-approved changes
 * that follow established procedures with known risks and outcomes.
 *
 * @param context The workflow context provided by the runtime
 */
export async function standardChangeApprovalWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state
  context.setState('validating_standard_criteria');
  
  const { triggerEvent } = context.input;
  const changeData = triggerEvent.payload;
  
  // Store change information
  data.set('changeId', changeData.change_id);
  data.set('changeNumber', changeData.change_number);
  data.set('changeType', 'standard');
  data.set('requestedBy', changeData.requested_by);
  
  logger.info(`Starting standard change approval for ${changeData.change_number}`);
  
  // Step 1: Validate against standard change criteria
  const validationResult = await validateStandardChangeCriteria(context, changeData);
  
  if (!validationResult.isValid) {
    // If validation fails, escalate to normal change process
    await escalateToNormalChange(context, validationResult.failureReasons);
    return;
  }
  
  // Step 2: Auto-approve standard change
  context.setState('auto_approving');
  await autoApproveStandardChange(context, changeData);
  
  // Step 3: Schedule implementation
  context.setState('scheduling');
  await scheduleStandardChange(context, changeData);
  
  // Step 4: Send notifications
  await sendApprovalNotifications(context);
  
  context.setState('approved');
  logger.info(`Standard change ${changeData.change_number} auto-approved`);
}

/**
 * Validate change against standard change criteria
 */
async function validateStandardChangeCriteria(context: any, changeData: any): Promise<{
  isValid: boolean;
  failureReasons: string[];
  validationDetails: any;
}> {
  const { actions, data, logger } = context;
  
  logger.info('Validating standard change criteria');
  
  const validationChecks = [];
  const failureReasons = [];
  
  // Check 1: Must be low risk
  if (changeData.risk_level !== 'low') {
    validationChecks.push({ check: 'risk_level', passed: false, reason: 'Risk level must be low for standard changes' });
    failureReasons.push('Risk level too high');
  } else {
    validationChecks.push({ check: 'risk_level', passed: true });
  }
  
  // Check 2: Must follow approved standard procedure
  const hasApprovedProcedure = await actions.checkStandardProcedure({
    category: changeData.change_category,
    subcategory: changeData.change_subcategory,
    changeDetails: changeData
  });
  
  if (!hasApprovedProcedure.exists) {
    validationChecks.push({ check: 'approved_procedure', passed: false, reason: 'No approved standard procedure exists' });
    failureReasons.push('No approved standard procedure');
  } else {
    validationChecks.push({ check: 'approved_procedure', passed: true, procedure: hasApprovedProcedure.procedure });
  }
  
  // Check 3: Implementation duration within limits
  const maxDurationHours = 4; // Standard changes should be quick
  if (changeData.estimated_duration > maxDurationHours) {
    validationChecks.push({ check: 'duration_limit', passed: false, reason: `Duration exceeds ${maxDurationHours} hour limit` });
    failureReasons.push('Implementation duration too long');
  } else {
    validationChecks.push({ check: 'duration_limit', passed: true });
  }
  
  // Check 4: No critical services affected
  const criticalServices = await actions.getCriticalServices();
  const affectsCriticalServices = changeData.affected_services?.some((service: string) => 
    criticalServices.includes(service)
  );
  
  if (affectsCriticalServices) {
    validationChecks.push({ check: 'critical_services', passed: false, reason: 'Cannot affect critical services' });
    failureReasons.push('Affects critical services');
  } else {
    validationChecks.push({ check: 'critical_services', passed: true });
  }
  
  // Check 5: Requestor has authorization for this type of change
  const hasAuthorization = await actions.checkUserAuthorization({
    userId: changeData.requested_by,
    changeCategory: changeData.change_category,
    changeType: 'standard'
  });
  
  if (!hasAuthorization.authorized) {
    validationChecks.push({ check: 'user_authorization', passed: false, reason: 'User not authorized for this standard change' });
    failureReasons.push('Insufficient authorization');
  } else {
    validationChecks.push({ check: 'user_authorization', passed: true });
  }
  
  // Check 6: No conflicts with existing changes
  const conflicts = await actions.detectChangeConflicts({
    changeId: changeData.change_id,
    scheduledDate: changeData.requested_date,
    affectedServices: changeData.affected_services
  });
  
  const criticalConflicts = conflicts.filter((c: any) => c.severity === 'critical');
  if (criticalConflicts.length > 0) {
    validationChecks.push({ check: 'conflict_detection', passed: false, reason: 'Critical conflicts detected' });
    failureReasons.push('Critical scheduling conflicts');
  } else {
    validationChecks.push({ check: 'conflict_detection', passed: true });
  }
  
  // Record validation results
  await actions.recordValidationResults({
    changeId: data.get('changeId'),
    validationType: 'standard_change_criteria',
    checks: validationChecks,
    overallResult: failureReasons.length === 0 ? 'passed' : 'failed'
  });
  
  data.set('validationResults', {
    checks: validationChecks,
    isValid: failureReasons.length === 0,
    failureReasons
  });
  
  return {
    isValid: failureReasons.length === 0,
    failureReasons,
    validationDetails: validationChecks
  };
}

/**
 * Auto-approve standard change
 */
async function autoApproveStandardChange(context: any, changeData: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Auto-approving standard change');
  
  // Update change request status
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    approvalStatus: 'approved',
    approvedBy: 'system',
    approvedAt: new Date().toISOString(),
    approvalType: 'standard_auto',
    approvalComments: 'Auto-approved as standard change meeting all criteria'
  });
  
  // Create approval record
  await actions.createApprovalRecord({
    changeId: data.get('changeId'),
    approverId: 'system',
    approvalType: 'standard_auto',
    decision: 'approved',
    comments: 'Standard change auto-approved based on pre-defined criteria',
    approvedAt: new Date().toISOString()
  });
  
  // Log approval in audit trail
  await actions.logAuditEvent({
    changeId: data.get('changeId'),
    eventType: 'change_approved',
    details: {
      approvalType: 'standard_auto',
      validationResults: data.get('validationResults')
    },
    performedBy: 'system',
    timestamp: new Date().toISOString()
  });
  
  data.set('approvalCompleted', true);
}

/**
 * Schedule standard change implementation
 */
async function scheduleStandardChange(context: any, changeData: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Scheduling standard change implementation');
  
  // For standard changes, try to schedule as soon as possible
  const preferredDate = changeData.requested_date ? new Date(changeData.requested_date) : new Date();
  
  // Get next available maintenance window or schedule immediately if low impact
  const schedulingOptions = await actions.getAvailableSchedulingWindows({
    changeRequest: changeData,
    preferredDate: preferredDate,
    durationHours: changeData.estimated_duration,
    allowOutsideMaintenanceWindow: true // Standard changes can run outside maintenance windows
  });
  
  let scheduledStart: Date;
  let scheduledEnd: Date;
  
  if (schedulingOptions.available.length > 0) {
    // Use the earliest available slot
    scheduledStart = new Date(schedulingOptions.available[0]);
    scheduledEnd = new Date(scheduledStart.getTime() + (changeData.estimated_duration * 60 * 60 * 1000));
  } else {
    // If no slots available, schedule for the requested date/time
    scheduledStart = preferredDate;
    scheduledEnd = new Date(scheduledStart.getTime() + (changeData.estimated_duration * 60 * 60 * 1000));
  }
  
  // Schedule the change
  await actions.scheduleChange({
    changeId: data.get('changeId'),
    scheduledStart: scheduledStart,
    scheduledEnd: scheduledEnd,
    scheduledBy: 'system',
    schedulingNotes: 'Auto-scheduled standard change'
  });
  
  // Update change status
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    status: 'scheduled',
    scheduledStartDate: scheduledStart,
    scheduledEndDate: scheduledEnd
  });
  
  data.set('scheduledStart', scheduledStart);
  data.set('scheduledEnd', scheduledEnd);
  
  // Start pre-implementation workflow
  await actions.startWorkflow({
    workflowType: 'preImplementationWorkflow',
    input: {
      triggerEvent: {
        type: 'Change:Scheduled',
        payload: {
          changeId: data.get('changeId'),
          scheduledStart: scheduledStart,
          scheduledEnd: scheduledEnd
        }
      }
    }
  });
}

/**
 * Send approval notifications
 */
async function sendApprovalNotifications(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Sending approval notifications');
  
  // Notify the requestor
  await actions.sendNotification({
    recipients: [data.get('requestedBy')],
    template: 'standard_change_approved',
    data: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      scheduledStart: data.get('scheduledStart'),
      scheduledEnd: data.get('scheduledEnd'),
      approvalType: 'standard_auto'
    }
  });
  
  // Notify change coordinators
  const changeCoordinators = await actions.getUsersByRole('change_coordinator');
  if (changeCoordinators.length > 0) {
    await actions.sendNotification({
      recipients: changeCoordinators.map((u: any) => u.user_id),
      template: 'standard_change_scheduled',
      data: {
        changeId: data.get('changeId'),
        changeNumber: data.get('changeNumber'),
        scheduledStart: data.get('scheduledStart'),
        requestedBy: data.get('requestedBy')
      }
    });
  }
  
  // Create calendar events for stakeholders
  await actions.createCalendarEvent({
    title: `Standard Change: ${data.get('changeNumber')}`,
    description: `Standard change implementation scheduled`,
    startTime: data.get('scheduledStart'),
    endTime: data.get('scheduledEnd'),
    attendees: [data.get('requestedBy')],
    changeId: data.get('changeId')
  });
}

/**
 * Escalate to normal change process
 */
async function escalateToNormalChange(context: any, failureReasons: string[]): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info(`Escalating to normal change due to: ${failureReasons.join(', ')}`);
  
  context.setState('escalated_to_normal');
  
  // Update change type
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    changeType: 'normal',
    escalationReason: `Standard change validation failed: ${failureReasons.join(', ')}`,
    escalatedFrom: 'standard',
    escalatedAt: new Date().toISOString()
  });
  
  // Start normal change approval workflow
  await actions.startWorkflow({
    workflowType: 'normalChangeApprovalWorkflow',
    input: {
      triggerEvent: {
        type: 'Change:EscalatedFromStandard',
        payload: {
          changeId: data.get('changeId'),
          escalationReasons: failureReasons,
          originalValidationResults: data.get('validationResults')
        }
      }
    }
  });
  
  // Notify requestor of escalation
  await actions.sendNotification({
    recipients: [data.get('requestedBy')],
    template: 'standard_change_escalated',
    data: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      escalationReasons: failureReasons,
      nextSteps: 'Your change has been escalated to normal change approval process'
    }
  });
  
  // Log escalation
  await actions.logAuditEvent({
    changeId: data.get('changeId'),
    eventType: 'change_escalated',
    details: {
      escalatedFrom: 'standard',
      escalatedTo: 'normal',
      reasons: failureReasons,
      validationResults: data.get('validationResults')
    },
    performedBy: 'system',
    timestamp: new Date().toISOString()
  });
}

export { standardChangeApprovalWorkflow };