/**
 * Emergency Change Approval Workflow
 *
 * Handles urgent approval for emergency changes that cannot wait for
 * normal CAB approval processes due to critical business needs.
 *
 * @param context The workflow context provided by the runtime
 */
export async function emergencyChangeApprovalWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state
  context.setState('emergency_validation');
  
  const { triggerEvent } = context.input;
  const changeData = triggerEvent.payload;
  
  // Store change information
  data.set('changeId', changeData.change_id);
  data.set('changeNumber', changeData.change_number);
  data.set('changeType', 'emergency');
  data.set('requestedBy', changeData.requested_by);
  data.set('emergencyJustification', changeData.emergency_justification);
  data.set('businessImpact', changeData.business_impact);
  
  logger.info(`Starting emergency change approval for ${changeData.change_number}`);
  
  // Step 1: Validate emergency criteria
  const emergencyValidation = await validateEmergencyCriteria(context, changeData);
  
  if (!emergencyValidation.isValid) {
    await rejectEmergencyChange(context, emergencyValidation.rejectionReasons);
    return;
  }
  
  // Step 2: Get immediate authorization from emergency approvers
  context.setState('seeking_emergency_authorization');
  const authorizationResult = await seekEmergencyAuthorization(context, changeData);
  
  if (!authorizationResult.approved) {
    await rejectEmergencyChange(context, [authorizationResult.rejectionReason || 'Emergency authorization denied']);
    return;
  }
  
  // Step 3: Perform rapid risk assessment
  context.setState('rapid_risk_assessment');
  await performRapidRiskAssessment(context, changeData);
  
  // Step 4: Approve with conditions
  context.setState('conditional_approval');
  await approveEmergencyChange(context, authorizationResult);
  
  // Step 5: Schedule immediate implementation
  context.setState('immediate_scheduling');
  await scheduleEmergencyImplementation(context, changeData);
  
  // Step 6: Start emergency CAB process (parallel)
  await initiateEmergencyCAB(context);
  
  // Step 7: Set up enhanced monitoring
  await setupEmergencyMonitoring(context);
  
  context.setState('approved');
  logger.info(`Emergency change ${changeData.change_number} approved for immediate implementation`);
}

/**
 * Validate emergency criteria
 */
async function validateEmergencyCriteria(context: any, changeData: any): Promise<{
  isValid: boolean;
  rejectionReasons: string[];
  validationDetails: any;
}> {
  const { actions, data, logger } = context;
  
  logger.info('Validating emergency change criteria');
  
  const validationChecks = [];
  const rejectionReasons = [];
  
  // Check 1: Emergency justification must be provided and valid
  if (!changeData.emergency_justification || changeData.emergency_justification.length < 50) {
    validationChecks.push({ 
      check: 'emergency_justification', 
      passed: false, 
      reason: 'Insufficient emergency justification provided' 
    });
    rejectionReasons.push('Inadequate emergency justification');
  } else {
    // Validate justification content using keywords
    const emergencyKeywords = [
      'critical', 'outage', 'security', 'breach', 'failure', 'down', 'urgent',
      'production', 'customer', 'revenue', 'compliance', 'regulatory'
    ];
    
    const hasValidKeywords = emergencyKeywords.some(keyword => 
      changeData.emergency_justification.toLowerCase().includes(keyword)
    );
    
    if (hasValidKeywords) {
      validationChecks.push({ check: 'emergency_justification', passed: true });
    } else {
      validationChecks.push({ 
        check: 'emergency_justification', 
        passed: false, 
        reason: 'Justification does not indicate true emergency' 
      });
      rejectionReasons.push('Justification does not meet emergency criteria');
    }
  }
  
  // Check 2: Business impact must be high
  if (changeData.business_impact !== 'high') {
    validationChecks.push({ 
      check: 'business_impact', 
      passed: false, 
      reason: 'Business impact must be high for emergency changes' 
    });
    rejectionReasons.push('Business impact not sufficient for emergency');
  } else {
    validationChecks.push({ check: 'business_impact', passed: true });
  }
  
  // Check 3: Check for recent emergency changes by same user
  const recentEmergencyCount = await actions.getRecentEmergencyChanges({
    userId: changeData.requested_by,
    timeframe: '7 days'
  });
  
  if (recentEmergencyCount.count > 2) {
    validationChecks.push({ 
      check: 'recent_emergency_limit', 
      passed: false, 
      reason: 'Too many recent emergency changes by this user' 
    });
    rejectionReasons.push('Emergency change quota exceeded');
  } else {
    validationChecks.push({ check: 'recent_emergency_limit', passed: true });
  }
  
  // Check 4: Validate that change cannot wait for normal approval
  const timeToNormalApproval = await actions.estimateNormalApprovalTime({
    changeType: 'normal',
    riskLevel: changeData.risk_level,
    requiresCAB: true
  });
  
  // If normal approval would take less than 4 hours, question emergency status
  if (timeToNormalApproval.estimatedHours < 4) {
    validationChecks.push({ 
      check: 'time_sensitivity', 
      passed: false, 
      reason: 'Normal approval process could complete in reasonable time' 
    });
    rejectionReasons.push('Change could wait for normal approval process');
  } else {
    validationChecks.push({ check: 'time_sensitivity', passed: true });
  }
  
  // Check 5: Verify requestor has emergency change authority
  const hasEmergencyAuthority = await actions.checkEmergencyAuthority({
    userId: changeData.requested_by,
    changeCategory: changeData.change_category
  });
  
  if (!hasEmergencyAuthority.authorized) {
    validationChecks.push({ 
      check: 'emergency_authority', 
      passed: false, 
      reason: 'User does not have emergency change authority' 
    });
    rejectionReasons.push('Insufficient emergency change authority');
  } else {
    validationChecks.push({ check: 'emergency_authority', passed: true });
  }
  
  // Record validation results
  await actions.recordValidationResults({
    changeId: data.get('changeId'),
    validationType: 'emergency_change_criteria',
    checks: validationChecks,
    overallResult: rejectionReasons.length === 0 ? 'passed' : 'failed'
  });
  
  data.set('emergencyValidation', {
    checks: validationChecks,
    isValid: rejectionReasons.length === 0,
    rejectionReasons
  });
  
  return {
    isValid: rejectionReasons.length === 0,
    rejectionReasons,
    validationDetails: validationChecks
  };
}

/**
 * Seek emergency authorization from designated approvers
 */
async function seekEmergencyAuthorization(context: any, changeData: any): Promise<{
  approved: boolean;
  approver?: string;
  approvedAt?: string;
  rejectionReason?: string;
  conditions?: string[];
}> {
  const { actions, events, data, logger } = context;
  
  logger.info('Seeking emergency authorization');
  
  // Get emergency approvers based on change impact and category
  const emergencyApprovers = await actions.getEmergencyApprovers({
    changeCategory: changeData.change_category,
    businessImpact: changeData.business_impact,
    affectedServices: changeData.affected_services
  });
  
  if (emergencyApprovers.length === 0) {
    logger.error('No emergency approvers available');
    return {
      approved: false,
      rejectionReason: 'No emergency approvers available'
    };
  }
  
  // Create urgent approval tasks for all emergency approvers
  const approvalTasks = [];
  for (const approver of emergencyApprovers) {
    const { taskId } = await actions.createHumanTask({
      taskType: 'emergency_change_authorization',
      title: `URGENT: Emergency Change Authorization - ${data.get('changeNumber')}`,
      description: `Emergency change requires immediate authorization: ${changeData.emergency_justification}`,
      priority: 'critical',
      dueDate: '30 minutes',
      assignTo: {
        userId: approver.user_id
      },
      contextData: {
        changeId: data.get('changeId'),
        changeNumber: data.get('changeNumber'),
        emergencyJustification: changeData.emergency_justification,
        businessImpact: changeData.business_impact,
        estimatedDuration: changeData.estimated_duration,
        affectedServices: changeData.affected_services,
        isEmergencyApproval: true
      }
    });
    
    approvalTasks.push({
      taskId,
      approverId: approver.user_id,
      approverName: approver.name,
      approverRole: approver.role
    });
  }
  
  // Send immediate notifications (SMS, email, phone calls)
  await actions.sendUrgentNotifications({
    recipients: emergencyApprovers,
    template: 'emergency_change_authorization',
    urgency: 'critical',
    channels: ['email', 'sms', 'push'],
    data: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      requestedBy: data.get('requestedBy'),
      emergencyJustification: changeData.emergency_justification,
      businessImpact: changeData.business_impact,
      deadline: '30 minutes'
    }
  });
  
  data.set('approvalTasks', approvalTasks);
  
  // Wait for first approval or timeout
  const approvalTimeout = 30 * 60 * 1000; // 30 minutes
  const taskEvents = approvalTasks.map(task => `Task:${task.taskId}:Complete`);
  
  try {
    // Wait for first approval or timeout
    const result = await Promise.race([
      events.waitForAny(taskEvents),
      events.waitForTimeout(approvalTimeout)
    ]);
    
    if (result?.type?.includes('Task:') && result?.type?.includes(':Complete')) {
      // An approval was received
      const approvalPayload = result.payload;
      const approvingTask = approvalTasks.find(task => 
        result.type === `Task:${task.taskId}:Complete`
      );
      
      if (approvalPayload.approved) {
        // Cancel other pending approval tasks
        for (const task of approvalTasks) {
          if (task.taskId !== approvingTask?.taskId) {
            await actions.cancelTask(task.taskId);
          }
        }
        
        return {
          approved: true,
          approver: approvingTask?.approverId,
          approvedAt: new Date().toISOString(),
          conditions: approvalPayload.conditions || []
        };
      } else {
        return {
          approved: false,
          rejectionReason: approvalPayload.rejectionReason || 'Emergency authorization denied'
        };
      }
    } else {
      // Timeout occurred
      logger.warn('Emergency authorization timed out');
      
      // Cancel all pending tasks
      for (const task of approvalTasks) {
        await actions.cancelTask(task.taskId);
      }
      
      return {
        approved: false,
        rejectionReason: 'Emergency authorization timed out (30 minutes)'
      };
    }
  } catch (error) {
    logger.error('Error during emergency authorization:', error);
    return {
      approved: false,
      rejectionReason: 'Error occurred during authorization process'
    };
  }
}

/**
 * Perform rapid risk assessment
 */
async function performRapidRiskAssessment(context: any, changeData: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Performing rapid risk assessment');
  
  // Simplified but comprehensive risk assessment for emergency changes
  const riskFactors = {
    timeConstraint: 'high', // Emergency = high time pressure
    testingLimited: changeData.testing_plan ? 'medium' : 'high',
    rollbackComplexity: changeData.rollback_plan ? 'medium' : 'high',
    businessImpact: changeData.business_impact,
    technicalComplexity: changeData.technical_impact || 'medium',
    affectedUsers: changeData.affected_services?.length > 2 ? 'high' : 'medium'
  };
  
  // Calculate overall emergency risk score
  const riskScore = await actions.calculateEmergencyRiskScore(riskFactors);
  
  // Generate emergency-specific mitigations
  const emergencyMitigations = [];
  
  if (!changeData.testing_plan) {
    emergencyMitigations.push('Implement post-change verification testing');
  }
  
  if (riskScore.score > 7) {
    emergencyMitigations.push('Require additional technical reviewer during implementation');
    emergencyMitigations.push('Implement enhanced monitoring during change window');
  }
  
  if (changeData.affected_services?.length > 3) {
    emergencyMitigations.push('Prepare communication plan for affected users');
    emergencyMitigations.push('Ensure rollback team is standing by');
  }
  
  emergencyMitigations.push('Schedule immediate post-implementation review');
  emergencyMitigations.push('Document all actions taken during emergency implementation');
  
  // Update change with risk assessment
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    emergencyRiskScore: riskScore.score,
    emergencyRiskLevel: riskScore.level,
    emergencyMitigations: emergencyMitigations,
    riskAssessmentDate: new Date().toISOString()
  });
  
  data.set('emergencyRiskScore', riskScore.score);
  data.set('emergencyRiskLevel', riskScore.level);
  data.set('emergencyMitigations', emergencyMitigations);
}

/**
 * Approve emergency change with conditions
 */
async function approveEmergencyChange(context: any, authorizationResult: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Approving emergency change');
  
  const conditions = [
    'Post-implementation review required within 24 hours',
    'Emergency CAB review scheduled within 48 hours',
    'Enhanced monitoring during implementation',
    'Immediate escalation if issues occur',
    ...(authorizationResult.conditions || []),
    ...(data.get('emergencyMitigations') || [])
  ];
  
  // Update change request
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    approvalStatus: 'approved',
    approvedBy: authorizationResult.approver,
    approvedAt: authorizationResult.approvedAt,
    approvalType: 'emergency',
    approvalConditions: conditions,
    approvalComments: 'Emergency change approved with enhanced monitoring and review requirements'
  });
  
  // Create detailed approval record
  await actions.createApprovalRecord({
    changeId: data.get('changeId'),
    approverId: authorizationResult.approver,
    approvalType: 'emergency',
    decision: 'approved',
    conditions: conditions,
    emergencyJustification: data.get('emergencyJustification'),
    riskScore: data.get('emergencyRiskScore'),
    approvedAt: authorizationResult.approvedAt
  });
  
  // Log approval in audit trail
  await actions.logAuditEvent({
    changeId: data.get('changeId'),
    eventType: 'emergency_change_approved',
    details: {
      approver: authorizationResult.approver,
      conditions: conditions,
      riskScore: data.get('emergencyRiskScore'),
      validationResults: data.get('emergencyValidation')
    },
    performedBy: authorizationResult.approver,
    timestamp: authorizationResult.approvedAt
  });
  
  data.set('approvalConditions', conditions);
}

/**
 * Schedule emergency implementation
 */
async function scheduleEmergencyImplementation(context: any, changeData: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Scheduling emergency implementation');
  
  // Emergency changes are scheduled immediately
  const scheduledStart = new Date(); // Start now
  const scheduledEnd = new Date(scheduledStart.getTime() + (changeData.estimated_duration * 60 * 60 * 1000));
  
  // Override any scheduling conflicts for emergency changes
  await actions.scheduleChange({
    changeId: data.get('changeId'),
    scheduledStart: scheduledStart,
    scheduledEnd: scheduledEnd,
    scheduledBy: 'emergency_workflow',
    schedulingNotes: 'Emergency change - immediate implementation authorized',
    overrideConflicts: true
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
}

/**
 * Initiate emergency CAB process
 */
async function initiateEmergencyCAB(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Initiating emergency CAB process');
  
  // Schedule emergency CAB meeting within 48 hours for post-approval review
  const cabMeetingDate = new Date();
  cabMeetingDate.setHours(cabMeetingDate.getHours() + 48);
  
  await actions.startWorkflow({
    workflowType: 'emergencyCABReviewWorkflow',
    input: {
      triggerEvent: {
        type: 'EmergencyChange:PostApprovalReview',
        payload: {
          changeId: data.get('changeId'),
          meetingDate: cabMeetingDate,
          reviewType: 'post_approval'
        }
      }
    }
  });
}

/**
 * Set up enhanced monitoring for emergency change
 */
async function setupEmergencyMonitoring(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Setting up enhanced monitoring');
  
  // Create monitoring tasks
  await actions.createMonitoringTasks({
    changeId: data.get('changeId'),
    monitoringType: 'emergency',
    tasks: [
      {
        type: 'implementation_monitoring',
        frequency: '15 minutes',
        duration: data.get('scheduledEnd')
      },
      {
        type: 'service_health_monitoring',
        frequency: '5 minutes',
        duration: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours post-implementation
      },
      {
        type: 'user_impact_monitoring',
        frequency: '30 minutes',
        duration: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      }
    ]
  });
  
  // Set up automated alerts
  await actions.configureEmergencyAlerts({
    changeId: data.get('changeId'),
    alertThresholds: {
      serviceAvailability: 99.5,
      responseTime: 150, // ms
      errorRate: 0.1 // %
    },
    recipients: [
      data.get('requestedBy'),
      data.get('approver'),
      'emergency_response_team'
    ]
  });
}

/**
 * Reject emergency change
 */
async function rejectEmergencyChange(context: any, rejectionReasons: string[]): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info(`Rejecting emergency change: ${rejectionReasons.join(', ')}`);
  
  context.setState('rejected');
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    approvalStatus: 'rejected',
    rejectionReason: rejectionReasons.join('; '),
    rejectedAt: new Date().toISOString(),
    rejectedBy: 'emergency_workflow'
  });
  
  // Suggest alternative approach
  const alternatives = [
    'Consider submitting as normal change with expedited review',
    'Implement temporary workaround while preparing proper change',
    'Contact change manager for guidance on proper emergency procedures'
  ];
  
  await actions.sendNotification({
    recipients: [data.get('requestedBy')],
    template: 'emergency_change_rejected',
    data: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      rejectionReasons: rejectionReasons,
      alternatives: alternatives
    }
  });
  
  // Log rejection
  await actions.logAuditEvent({
    changeId: data.get('changeId'),
    eventType: 'emergency_change_rejected',
    details: {
      rejectionReasons: rejectionReasons,
      validationResults: data.get('emergencyValidation')
    },
    performedBy: 'emergency_workflow',
    timestamp: new Date().toISOString()
  });
}

export { emergencyChangeApprovalWorkflow };