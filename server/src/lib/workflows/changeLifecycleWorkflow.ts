/**
 * ITIL Change Lifecycle Workflow
 *
 * Manages the complete lifecycle of a change request from creation to closure,
 * including approval routing, scheduling, implementation, and post-implementation review.
 *
 * @param context The workflow context provided by the runtime
 */
export async function changeLifecycleWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state - Processing
  context.setState('change_logged');
  
  // The workflow is triggered by a change request creation event
  const { triggerEvent } = context.input;
  const changeData = triggerEvent.payload;
  
  // Store change information
  data.set('changeId', changeData.change_id);
  data.set('changeNumber', changeData.change_number);
  data.set('changeType', changeData.change_type);
  data.set('riskLevel', changeData.risk_level);
  data.set('requestedBy', changeData.requested_by);
  data.set('createdAt', changeData.created_date);
  
  logger.info(`Starting ITIL change lifecycle for ${changeData.change_number}`);
  
  // Step 1: Initial Assessment and Risk Evaluation
  await performInitialAssessment(context, changeData);
  
  // Step 2: Approval Routing Based on Change Type
  context.setState('approval_routing');
  const approvalResult = await routeForApproval(context, changeData);
  
  if (!approvalResult.approved) {
    context.setState('rejected');
    await handleChangeRejection(context, approvalResult.rejectionReason);
    return;
  }
  
  // Step 3: Change Scheduling and Planning
  context.setState('scheduling');
  await performChangeScheduling(context);
  
  // Step 4: Pre-Implementation Validation
  context.setState('pre_implementation');
  const validationResult = await performPreImplementationValidation(context);
  
  if (!validationResult.passed) {
    await handleValidationFailure(context, validationResult.issues);
    return;
  }
  
  // Step 5: Implementation Phase
  context.setState('implementing');
  const implementationResult = await manageImplementation(context);
  
  if (!implementationResult.successful) {
    await handleImplementationFailure(context, implementationResult);
    return;
  }
  
  // Step 6: Post-Implementation Review
  context.setState('post_implementation');
  await performPostImplementationReview(context);
  
  // Step 7: Change Closure
  context.setState('closed');
  await performChangeClosure(context);
  
  logger.info('ITIL change lifecycle completed successfully');
}

/**
 * Perform initial assessment and risk evaluation
 */
async function performInitialAssessment(context: any, changeData: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Performing initial change assessment');
  
  // Conduct automated risk assessment
  const riskAssessment = await actions.assessChangeRisk({
    changeId: data.get('changeId'),
    changeType: changeData.change_type,
    affectedServices: changeData.affected_services,
    businessImpact: changeData.business_impact,
    technicalComplexity: changeData.technical_complexity
  });
  
  data.set('riskAssessment', riskAssessment);
  data.set('calculatedRiskLevel', riskAssessment.overallRiskLevel);
  
  // Update change request with risk assessment results
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    riskLevel: riskAssessment.overallRiskLevel,
    riskScore: riskAssessment.riskScore,
    riskFactors: riskAssessment.factorScores,
    mitigationStrategies: riskAssessment.mitigationStrategies
  });
  
  // Check for potential conflicts
  const conflicts = await actions.detectChangeConflicts({
    changeId: data.get('changeId'),
    scheduledDate: changeData.requested_date,
    affectedServices: changeData.affected_services
  });
  
  if (conflicts.length > 0) {
    data.set('potentialConflicts', conflicts);
    logger.warn(`Detected ${conflicts.length} potential conflicts for change ${data.get('changeNumber')}`);
  }
  
  // Determine if CAB approval is required
  const requiresCAB = await determineCABRequirement(context, changeData, riskAssessment);
  data.set('requiresCAB', requiresCAB);
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    cabRequired: requiresCAB,
    assessmentCompleted: true,
    assessmentDate: new Date().toISOString()
  });
}

/**
 * Route change for appropriate approval based on type and risk
 */
async function routeForApproval(context: any, changeData: any): Promise<{ approved: boolean; rejectionReason?: string }> {
  const { actions, events, data, logger } = context;
  
  const changeType = data.get('changeType');
  const riskLevel = data.get('calculatedRiskLevel');
  const requiresCAB = data.get('requiresCAB');
  
  logger.info(`Routing change for approval: type=${changeType}, risk=${riskLevel}, CAB=${requiresCAB}`);
  
  switch (changeType) {
    case 'standard':
      return await processStandardChangeApproval(context);
      
    case 'emergency':
      return await processEmergencyChangeApproval(context);
      
    case 'normal':
    default:
      if (requiresCAB) {
        return await processCABApproval(context);
      } else {
        return await processManagerApproval(context);
      }
  }
}

/**
 * Process standard change approval (pre-approved)
 */
async function processStandardChangeApproval(context: any): Promise<{ approved: boolean }> {
  const { actions, data, logger } = context;
  
  logger.info('Processing standard change approval');
  
  // Standard changes are pre-approved, just validate against criteria
  const validationResult = await actions.validateStandardChange({
    changeId: data.get('changeId'),
    changeDetails: await actions.getChangeRequest(data.get('changeId'))
  });
  
  if (validationResult.valid) {
    await actions.updateChangeRequest({
      changeId: data.get('changeId'),
      approvalStatus: 'approved',
      approvedBy: 'system',
      approvedAt: new Date().toISOString(),
      approvalType: 'standard_auto'
    });
    
    return { approved: true };
  } else {
    // If validation fails, escalate to normal change process
    await actions.updateChangeRequest({
      changeId: data.get('changeId'),
      changeType: 'normal',
      escalationReason: 'Standard change validation failed'
    });
    
    return await processManagerApproval(context);
  }
}

/**
 * Process emergency change approval
 */
async function processEmergencyChangeApproval(context: any): Promise<{ approved: boolean; rejectionReason?: string }> {
  const { actions, events, data, logger } = context;
  
  logger.info('Processing emergency change approval');
  
  // Create emergency approval task for change manager
  const { taskId } = await actions.createHumanTask({
    taskType: 'emergency_change_approval',
    title: `Emergency Change Approval - ${data.get('changeNumber')}`,
    description: 'Emergency change requires immediate approval',
    priority: 'critical',
    dueDate: '1 hour',
    assignTo: {
      roles: ['change_manager', 'service_manager']
    },
    contextData: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      emergencyJustification: data.get('emergencyJustification'),
      riskLevel: data.get('riskLevel')
    }
  });
  
  // Send urgent notifications
  await actions.sendNotification({
    recipients: await actions.getEmergencyApprovers(),
    template: 'emergency_change_approval',
    urgency: 'high',
    data: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      taskId: taskId
    }
  });
  
  // Wait for approval decision
  const approvalEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const decision = approvalEvent.payload;
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    approvalStatus: decision.approved ? 'approved' : 'rejected',
    approvedBy: decision.userId,
    approvedAt: new Date().toISOString(),
    approvalType: 'emergency',
    approvalComments: decision.comments
  });
  
  if (decision.approved) {
    // Start emergency CAB workflow in parallel
    await actions.startWorkflow({
      workflowType: 'emergencyCABWorkflow',
      input: {
        triggerEvent: {
          type: 'EmergencyChange:Approved',
          payload: { changeId: data.get('changeId') }
        }
      }
    });
  }
  
  return {
    approved: decision.approved,
    rejectionReason: decision.approved ? undefined : decision.rejectionReason
  };
}

/**
 * Process CAB approval for normal changes
 */
async function processCABApproval(context: any): Promise<{ approved: boolean; rejectionReason?: string }> {
  const { actions, events, data, logger } = context;
  
  logger.info('Processing CAB approval');
  
  // Start CAB approval workflow
  const cabWorkflowId = await actions.startWorkflow({
    workflowType: 'cabApprovalWorkflow',
    input: {
      triggerEvent: {
        type: 'Change:CABReviewRequired',
        payload: {
          changeId: data.get('changeId'),
          changeData: await actions.getChangeRequest(data.get('changeId'))
        }
      }
    }
  });
  
  data.set('cabWorkflowId', cabWorkflowId);
  
  // Wait for CAB decision
  const cabEvent = await events.waitFor(`CAB:${data.get('changeId')}:Decision`);
  const cabDecision = cabEvent.payload;
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    approvalStatus: cabDecision.approved ? 'approved' : 'rejected',
    cabDecision: cabDecision.decision,
    cabMeetingId: cabDecision.meetingId,
    approvedAt: new Date().toISOString(),
    approvalComments: cabDecision.comments
  });
  
  return {
    approved: cabDecision.approved,
    rejectionReason: cabDecision.approved ? undefined : cabDecision.rejectionReason
  };
}

/**
 * Process manager approval for low-risk normal changes
 */
async function processManagerApproval(context: any): Promise<{ approved: boolean; rejectionReason?: string }> {
  const { actions, events, data, logger } = context;
  
  logger.info('Processing manager approval');
  
  const { taskId } = await actions.createHumanTask({
    taskType: 'change_approval',
    title: `Change Approval Required - ${data.get('changeNumber')}`,
    description: 'Normal change requires manager approval',
    priority: data.get('riskLevel') === 'high' ? 'high' : 'medium',
    dueDate: data.get('riskLevel') === 'high' ? '4 hours' : '24 hours',
    assignTo: {
      roles: ['change_manager', 'team_lead']
    },
    contextData: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      riskLevel: data.get('riskLevel'),
      riskAssessment: data.get('riskAssessment')
    }
  });
  
  const approvalEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const decision = approvalEvent.payload;
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    approvalStatus: decision.approved ? 'approved' : 'rejected',
    approvedBy: decision.userId,
    approvedAt: new Date().toISOString(),
    approvalType: 'manager',
    approvalComments: decision.comments
  });
  
  return {
    approved: decision.approved,
    rejectionReason: decision.approved ? undefined : decision.rejectionReason
  };
}

/**
 * Perform change scheduling
 */
async function performChangeScheduling(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Performing change scheduling');
  
  const changeRequest = await actions.getChangeRequest(data.get('changeId'));
  
  // Get available scheduling windows
  const schedulingOptions = await actions.getAvailableSchedulingWindows({
    changeRequest,
    preferredDate: changeRequest.requested_date,
    durationHours: changeRequest.estimated_duration
  });
  
  data.set('schedulingOptions', schedulingOptions);
  
  // For emergency changes, schedule immediately if possible
  if (data.get('changeType') === 'emergency') {
    const immediateSlot = schedulingOptions.available[0];
    if (immediateSlot) {
      await actions.scheduleChange({
        changeId: data.get('changeId'),
        scheduledStart: immediateSlot,
        scheduledEnd: new Date(immediateSlot.getTime() + (changeRequest.estimated_duration * 60 * 60 * 1000)),
        scheduledBy: 'system'
      });
      
      data.set('schedulingCompleted', true);
      return;
    }
  }
  
  // For normal changes, create scheduling task
  const { taskId } = await actions.createHumanTask({
    taskType: 'change_scheduling',
    title: `Schedule Change - ${data.get('changeNumber')}`,
    description: 'Select optimal scheduling window for change implementation',
    priority: 'medium',
    dueDate: '48 hours',
    assignTo: {
      roles: ['change_coordinator', 'change_manager']
    },
    contextData: {
      changeId: data.get('changeId'),
      schedulingOptions: schedulingOptions,
      conflicts: schedulingOptions.conflicts
    }
  });
  
  // Wait for scheduling completion
  const schedulingEvent = await context.events.waitFor(`Task:${taskId}:Complete`);
  const schedulingResult = schedulingEvent.payload;
  
  await actions.scheduleChange({
    changeId: data.get('changeId'),
    scheduledStart: new Date(schedulingResult.scheduledStart),
    scheduledEnd: new Date(schedulingResult.scheduledEnd),
    scheduledBy: schedulingResult.userId,
    schedulingNotes: schedulingResult.notes
  });
  
  data.set('schedulingCompleted', true);
}

/**
 * Perform pre-implementation validation
 */
async function performPreImplementationValidation(context: any): Promise<{ passed: boolean; issues?: string[] }> {
  const { actions, data, logger } = context;
  
  logger.info('Performing pre-implementation validation');
  
  const validationChecks = [
    'implementation_plan_approved',
    'rollback_plan_verified',
    'testing_plan_complete',
    'resources_allocated',
    'dependencies_satisfied',
    'change_window_confirmed'
  ];
  
  const validationResults = await actions.performValidationChecks({
    changeId: data.get('changeId'),
    checks: validationChecks
  });
  
  const failedChecks = validationResults.filter(check => !check.passed);
  
  if (failedChecks.length > 0) {
    // Create remediation tasks for failed checks
    for (const failedCheck of failedChecks) {
      await actions.createHumanTask({
        taskType: 'validation_remediation',
        title: `Resolve Validation Issue - ${failedCheck.checkName}`,
        description: failedCheck.description,
        priority: 'high',
        dueDate: '24 hours',
        assignTo: {
          userId: data.get('requestedBy')
        },
        contextData: {
          changeId: data.get('changeId'),
          validationCheck: failedCheck.checkName,
          issue: failedCheck.issue
        }
      });
    }
    
    return {
      passed: false,
      issues: failedChecks.map(check => check.issue)
    };
  }
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    validationCompleted: true,
    validationDate: new Date().toISOString(),
    readyForImplementation: true
  });
  
  return { passed: true };
}

/**
 * Manage change implementation
 */
async function manageImplementation(context: any): Promise<{ successful: boolean; rollbackRequired?: boolean }> {
  const { actions, events, data, logger } = context;
  
  logger.info('Managing change implementation');
  
  // Create implementation task
  const { taskId } = await actions.createHumanTask({
    taskType: 'change_implementation',
    title: `Implement Change - ${data.get('changeNumber')}`,
    description: 'Execute change implementation according to approved plan',
    priority: 'high',
    dueDate: '4 hours',
    assignTo: {
      userId: data.get('implementer') || data.get('requestedBy')
    },
    contextData: {
      changeId: data.get('changeId'),
      implementationPlan: data.get('implementationPlan'),
      rollbackPlan: data.get('rollbackPlan')
    }
  });
  
  // Start implementation monitoring
  await actions.startImplementationMonitoring({
    changeId: data.get('changeId'),
    taskId: taskId
  });
  
  // Wait for implementation completion
  const implementationEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const result = implementationEvent.payload;
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    implementationStatus: result.successful ? 'successful' : 'failed',
    implementationCompleted: true,
    implementationDate: new Date().toISOString(),
    implementationNotes: result.notes
  });
  
  if (!result.successful && result.rollbackRequired) {
    await initiateRollback(context, result.rollbackReason);
  }
  
  return {
    successful: result.successful,
    rollbackRequired: result.rollbackRequired
  };
}

/**
 * Perform post-implementation review
 */
async function performPostImplementationReview(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Performing post-implementation review');
  
  // Create post-implementation review task
  const { taskId } = await actions.createHumanTask({
    taskType: 'post_implementation_review',
    title: `Post-Implementation Review - ${data.get('changeNumber')}`,
    description: 'Verify change success and document lessons learned',
    priority: 'medium',
    dueDate: '48 hours',
    assignTo: {
      roles: ['change_manager']
    },
    contextData: {
      changeId: data.get('changeId'),
      implementationResults: data.get('implementationResults')
    }
  });
  
  // Wait for review completion
  const reviewEvent = await context.events.waitFor(`Task:${taskId}:Complete`);
  const reviewResult = reviewEvent.payload;
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    reviewCompleted: true,
    reviewDate: new Date().toISOString(),
    reviewOutcome: reviewResult.outcome,
    lessonsLearned: reviewResult.lessonsLearned,
    recommendationsForFuture: reviewResult.recommendations
  });
  
  // Update change success metrics
  await actions.updateChangeMetrics({
    changeId: data.get('changeId'),
    successful: reviewResult.outcome === 'successful',
    reviewScore: reviewResult.score
  });
}

/**
 * Perform change closure
 */
async function performChangeClosure(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Performing change closure');
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    status: 'closed',
    closedAt: new Date().toISOString(),
    closedBy: 'workflow'
  });
  
  // Send closure notifications
  await actions.sendNotification({
    recipients: [data.get('requestedBy')],
    template: 'change_closed',
    data: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      outcome: data.get('reviewOutcome')
    }
  });
  
  // Archive change documentation
  await actions.archiveChangeDocumentation({
    changeId: data.get('changeId')
  });
}

/**
 * Determine if CAB approval is required
 */
async function determineCABRequirement(context: any, changeData: any, riskAssessment: any): Promise<boolean> {
  // CAB required for:
  // - High risk changes
  // - Changes affecting critical services
  // - Changes with significant business impact
  // - Changes requested by business stakeholders
  
  if (riskAssessment.overallRiskLevel === 'high') return true;
  if (changeData.business_impact === 'high') return true;
  if (changeData.affected_services?.includes('critical')) return true;
  if (changeData.change_category === 'major') return true;
  
  return false;
}

/**
 * Handle change rejection
 */
async function handleChangeRejection(context: any, rejectionReason: string): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info(`Handling change rejection: ${rejectionReason}`);
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    status: 'rejected',
    rejectionReason: rejectionReason,
    rejectedAt: new Date().toISOString()
  });
  
  await actions.sendNotification({
    recipients: [data.get('requestedBy')],
    template: 'change_rejected',
    data: {
      changeNumber: data.get('changeNumber'),
      rejectionReason: rejectionReason
    }
  });
}

/**
 * Handle validation failure
 */
async function handleValidationFailure(context: any, issues: string[]): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.warn(`Validation failed with issues: ${issues.join(', ')}`);
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    status: 'validation_failed',
    validationIssues: issues
  });
}

/**
 * Handle implementation failure
 */
async function handleImplementationFailure(context: any, result: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.error(`Implementation failed: ${result.failureReason}`);
  
  await actions.updateChangeRequest({
    changeId: data.get('changeId'),
    status: 'implementation_failed',
    failureReason: result.failureReason
  });
  
  if (result.rollbackRequired) {
    await initiateRollback(context, result.failureReason);
  }
}

/**
 * Initiate rollback procedure
 */
async function initiateRollback(context: any, rollbackReason: string): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info(`Initiating rollback: ${rollbackReason}`);
  
  await actions.startWorkflow({
    workflowType: 'changeRollbackWorkflow',
    input: {
      triggerEvent: {
        type: 'Change:RollbackRequired',
        payload: {
          changeId: data.get('changeId'),
          rollbackReason: rollbackReason
        }
      }
    }
  });
}

export { changeLifecycleWorkflow };