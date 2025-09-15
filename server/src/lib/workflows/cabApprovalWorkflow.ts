/**
 * Change Advisory Board (CAB) Approval Workflow
 *
 * Manages the CAB approval process for change requests following ITIL best practices.
 * Handles meeting scheduling, voting, and decision tracking.
 *
 * @param context The workflow context provided by the runtime
 */
export async function cabApprovalWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state - CAB Review Initiated
  context.setState('cab_review_initiated');
  
  // The workflow is triggered by a change request submission
  const { triggerEvent } = context.input;
  const changeData = triggerEvent.payload;
  
  // Store change information
  data.set('changeId', changeData.change_id);
  data.set('changeNumber', changeData.change_number);
  data.set('changeType', changeData.change_type);
  data.set('riskLevel', changeData.risk_level);
  data.set('requestedBy', changeData.requested_by);
  
  logger.info(`Starting CAB approval process for ${changeData.change_number}`);
  
  // Phase 1: Determine appropriate CAB
  const appropriateCAB = await determineAppropriateCAB(context, changeData);
  
  if (!appropriateCAB) {
    // No CAB required, proceed with direct approval
    await processDirectApproval(context);
    return;
  }
  
  // Phase 2: Schedule CAB review
  await scheduleCabReview(context, appropriateCAB);
  
  // Phase 3: CAB Meeting Process
  await processCabMeeting(context);
  
  // Phase 4: Decision Implementation
  await implementCabDecision(context);
  
  context.setState('cab_process_completed');
  logger.info('CAB approval workflow completed');
}

/**
 * Determine the appropriate CAB for the change request
 */
async function determineAppropriateCAB(context: any, changeData: any): Promise<any> {
  const { actions, data, logger } = context;
  
  logger.info('Determining appropriate CAB');
  
  // Get active CABs that can handle this change type and risk level
  const availableCABs = await actions.getAvailableCABs({
    changeType: changeData.change_type,
    riskLevel: changeData.risk_level,
    emergencyChange: changeData.emergency_change
  });
  
  if (availableCABs.length === 0) {
    logger.info('No CAB required for this change');
    return null;
  }
  
  // For emergency changes, use emergency CAB or expedited process
  if (changeData.emergency_change) {
    const emergencyCAB = availableCABs.find(cab => cab.meeting_type === 'emergency');
    if (emergencyCAB) {
      data.set('selectedCAB', emergencyCAB);
      data.set('meetingType', 'emergency');
      return emergencyCAB;
    }
  }
  
  // Select CAB based on change characteristics
  let selectedCAB = availableCABs[0]; // Default to first available
  
  // Prefer CAB that specializes in this change category
  const specializedCAB = availableCABs.find(cab => 
    cab.specialized_categories && 
    cab.specialized_categories.includes(changeData.change_category)
  );
  
  if (specializedCAB) {
    selectedCAB = specializedCAB;
  }
  
  data.set('selectedCAB', selectedCAB);
  data.set('meetingType', changeData.emergency_change ? 'emergency' : 'regular');
  
  logger.info(`Selected CAB: ${selectedCAB.name}`);
  return selectedCAB;
}

/**
 * Process direct approval for changes that don't require CAB
 */
async function processDirectApproval(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Processing direct approval');
  context.setState('direct_approval');
  
  const changeId = data.get('changeId');
  const changeType = data.get('changeType');
  
  if (changeType === 'standard') {
    // Standard changes are pre-approved
    await actions.approveChange({
      changeId,
      approvedBy: 'system',
      approvalType: 'standard_pre_approved',
      notes: 'Standard change - pre-approved based on change type'
    });
    
    context.setState('approved');
  } else {
    // Create manual approval task for low-risk changes
    const { taskId } = await actions.createHumanTask({
      taskType: 'change_approval',
      title: `Direct Approval - ${data.get('changeNumber')}`,
      description: 'Change does not require CAB approval. Direct approval needed.',
      priority: 'medium',
      dueDate: '2 days',
      assignTo: {
        roles: ['change_manager', 'service_owner']
      },
      contextData: {
        changeId,
        changeNumber: data.get('changeNumber'),
        riskLevel: data.get('riskLevel'),
        approvalType: 'direct'
      }
    });
    
    // Wait for approval decision
    const approvalEvent = await context.events.waitFor(`Task:${taskId}:Complete`);
    
    if (approvalEvent.payload.approved) {
      await actions.approveChange({
        changeId,
        approvedBy: approvalEvent.user_id,
        approvalType: 'direct_approval',
        notes: approvalEvent.payload.notes
      });
      
      context.setState('approved');
    } else {
      await actions.rejectChange({
        changeId,
        rejectedBy: approvalEvent.user_id,
        reason: approvalEvent.payload.rejectionReason
      });
      
      context.setState('rejected');
    }
  }
}

/**
 * Schedule CAB review meeting
 */
async function scheduleCabReview(context: any, cab: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Scheduling CAB review');
  context.setState('scheduling_cab_meeting');
  
  const changeId = data.get('changeId');
  const meetingType = data.get('meetingType');
  
  // Update change status
  await actions.updateChangeStatus({
    changeId,
    status: 'awaiting_cab'
  });
  
  // Check if there's an upcoming scheduled meeting that can accommodate this change
  const upcomingMeeting = await actions.getNextScheduledCABMeeting({
    cabId: cab.cab_id,
    lookAheadDays: meetingType === 'emergency' ? 2 : 14
  });
  
  if (upcomingMeeting && meetingType !== 'emergency') {
    // Add to existing meeting
    await actions.addChangeToCABMeeting({
      meetingId: upcomingMeeting.meeting_id,
      changeId,
      addedBy: 'workflow'
    });
    
    data.set('cabMeetingId', upcomingMeeting.meeting_id);
    data.set('meetingDate', upcomingMeeting.meeting_date);
    
    logger.info(`Added to existing CAB meeting on ${upcomingMeeting.meeting_date}`);
  } else {
    // Schedule new meeting
    const meetingDate = calculateMeetingDate(meetingType);
    
    const cabMeeting = await actions.createCABMeeting({
      cabId: cab.cab_id,
      meetingDate,
      meetingType,
      changeIds: [changeId],
      scheduledBy: 'workflow'
    });
    
    data.set('cabMeetingId', cabMeeting.meeting_id);
    data.set('meetingDate', meetingDate);
    
    logger.info(`Scheduled new CAB meeting for ${meetingDate}`);
  }
  
  // Send notifications to CAB members
  await actions.sendNotification({
    recipients: cab.members,
    template: 'cab_meeting_scheduled',
    data: {
      changeNumber: data.get('changeNumber'),
      meetingDate: data.get('meetingDate'),
      meetingType,
      cabName: cab.name
    }
  });
  
  // Send notification to change requestor
  await actions.sendNotification({
    recipient: data.get('requestedBy'),
    template: 'change_scheduled_for_cab',
    data: {
      changeNumber: data.get('changeNumber'),
      meetingDate: data.get('meetingDate'),
      cabName: cab.name
    }
  });
}

/**
 * Process CAB meeting and voting
 */
async function processCabMeeting(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Processing CAB meeting');
  context.setState('cab_meeting_in_progress');
  
  const cabMeetingId = data.get('cabMeetingId');
  const changeId = data.get('changeId');
  
  // Wait for meeting to start
  await events.waitFor(`CABMeeting:${cabMeetingId}:Started`);
  
  // Create CAB review task
  const { taskId } = await actions.createHumanTask({
    taskType: 'cab_change_review',
    title: `CAB Review - ${data.get('changeNumber')}`,
    description: 'Review change request and cast vote in CAB meeting',
    priority: 'high',
    dueDate: '4 hours', // Meeting duration
    assignTo: {
      meetingId: cabMeetingId,
      roleType: 'cab_member'
    },
    contextData: {
      changeId,
      changeNumber: data.get('changeNumber'),
      meetingId: cabMeetingId,
      reviewCriteria: [
        'Business justification',
        'Technical feasibility',
        'Risk assessment accuracy',
        'Implementation plan completeness',
        'Backout plan adequacy',
        'Resource availability',
        'Schedule appropriateness'
      ]
    }
  });
  
  // Wait for CAB decision
  const cabDecisionEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const decision = cabDecisionEvent.payload;
  
  // Record CAB decision
  await actions.recordCABDecision({
    meetingId: cabMeetingId,
    changeId,
    decision: decision.decision, // 'approved', 'rejected', 'deferred', 'conditional'
    rationale: decision.rationale,
    conditions: decision.conditions,
    votesFor: decision.votesFor,
    votesAgainst: decision.votesAgainst,
    abstentions: decision.abstentions,
    decidedBy: cabDecisionEvent.user_id
  });
  
  data.set('cabDecision', decision);
  
  logger.info(`CAB decision: ${decision.decision}`);
}

/**
 * Implement CAB decision
 */
async function implementCabDecision(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Implementing CAB decision');
  
  const changeId = data.get('changeId');
  const decision = data.get('cabDecision');
  const selectedCAB = data.get('selectedCAB');
  
  switch (decision.decision) {
    case 'approved':
      await actions.approveChange({
        changeId,
        approvedBy: selectedCAB.chair_user_id,
        approvalType: 'cab_approved',
        notes: decision.rationale,
        implementationWindow: decision.implementationWindow,
        specialConditions: decision.conditions
      });
      
      await actions.sendNotification({
        recipient: data.get('requestedBy'),
        template: 'change_approved_by_cab',
        data: {
          changeNumber: data.get('changeNumber'),
          rationale: decision.rationale,
          conditions: decision.conditions,
          implementationWindow: decision.implementationWindow
        }
      });
      
      context.setState('approved');
      break;
      
    case 'rejected':
      await actions.rejectChange({
        changeId,
        rejectedBy: selectedCAB.chair_user_id,
        reason: decision.rationale
      });
      
      await actions.sendNotification({
        recipient: data.get('requestedBy'),
        template: 'change_rejected_by_cab',
        data: {
          changeNumber: data.get('changeNumber'),
          rationale: decision.rationale
        }
      });
      
      context.setState('rejected');
      break;
      
    case 'conditional':
      await actions.updateChangeStatus({
        changeId,
        status: 'conditional_approval',
        notes: `Conditional approval: ${decision.conditions}`
      });
      
      // Create task for change requestor to address conditions
      await actions.createHumanTask({
        taskType: 'address_cab_conditions',
        title: `Address CAB Conditions - ${data.get('changeNumber')}`,
        description: 'Address conditions specified by CAB for approval',
        priority: 'high',
        dueDate: '5 days',
        assignTo: {
          userId: data.get('requestedBy')
        },
        contextData: {
          changeId,
          conditions: decision.conditions,
          rationale: decision.rationale
        }
      });
      
      await actions.sendNotification({
        recipient: data.get('requestedBy'),
        template: 'change_conditional_approval',
        data: {
          changeNumber: data.get('changeNumber'),
          conditions: decision.conditions,
          rationale: decision.rationale
        }
      });
      
      context.setState('conditional_approval');
      break;
      
    case 'deferred':
      await actions.updateChangeStatus({
        changeId,
        status: 'deferred',
        notes: `Deferred by CAB: ${decision.rationale}`
      });
      
      // Schedule for next CAB meeting
      await scheduleCabReview(context, selectedCAB);
      
      await actions.sendNotification({
        recipient: data.get('requestedBy'),
        template: 'change_deferred_by_cab',
        data: {
          changeNumber: data.get('changeNumber'),
          rationale: decision.rationale,
          nextMeetingDate: data.get('meetingDate')
        }
      });
      
      context.setState('deferred');
      break;
  }
}

/**
 * Calculate meeting date based on type
 */
function calculateMeetingDate(meetingType: string): string {
  const now = new Date();
  
  switch (meetingType) {
    case 'emergency':
      // Emergency meetings within 24 hours
      now.setHours(now.getHours() + 2);
      return now.toISOString();
      
    case 'special':
      // Special meetings within 3 days
      now.setDate(now.getDate() + 1);
      return now.toISOString();
      
    default:
      // Regular meetings - next scheduled slot
      now.setDate(now.getDate() + 7);
      now.setHours(14, 0, 0, 0); // 2 PM default
      return now.toISOString();
  }
}

/**
 * Emergency CAB Workflow for urgent changes
 */
export async function emergencyCABWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting Emergency CAB workflow');
  context.setState('emergency_cab_initiated');
  
  const { triggerEvent } = context.input;
  const changeData = triggerEvent.payload;
  
  data.set('changeId', changeData.change_id);
  data.set('changeNumber', changeData.change_number);
  
  // Emergency changes require immediate attention
  const emergencyCAB = await actions.getEmergencyCAB();
  
  if (!emergencyCAB) {
    // No emergency CAB configured, use expedited approval process
    await processExpeditedApproval(context);
    return;
  }
  
  // Create emergency meeting
  const emergencyMeeting = await actions.createEmergencyCABMeeting({
    cabId: emergencyCAB.cab_id,
    changeId: changeData.change_id,
    urgency: 'critical'
  });
  
  data.set('cabMeetingId', emergencyMeeting.meeting_id);
  
  // Immediate notification to all CAB members
  await actions.sendUrgentNotification({
    recipients: emergencyCAB.members,
    template: 'emergency_cab_meeting',
    data: {
      changeNumber: changeData.change_number,
      meetingId: emergencyMeeting.meeting_id,
      urgency: 'Emergency approval required within 2 hours'
    }
  });
  
  // Wait for emergency decision with timeout
  const decisionTimeout = 2 * 60 * 60 * 1000; // 2 hours
  
  const result = await Promise.race([
    events.waitFor(`CABMeeting:${emergencyMeeting.meeting_id}:Decision`),
    events.waitForTimeout(decisionTimeout)
  ]);
  
  if (result?.type === 'CABMeeting:Decision') {
    await implementCabDecision(context);
  } else {
    // Timeout - escalate to senior management
    await actions.escalateEmergencyChange({
      changeId: changeData.change_id,
      reason: 'Emergency CAB timeout - no decision within 2 hours',
      escalateTo: ['senior_management', 'cto']
    });
    
    context.setState('escalated');
  }
}

/**
 * Expedited approval process when no emergency CAB is available
 */
async function processExpeditedApproval(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Processing expedited approval');
  
  // Create high-priority approval task for senior management
  const { taskId } = await actions.createHumanTask({
    taskType: 'emergency_change_approval',
    title: `URGENT: Emergency Change Approval - ${data.get('changeNumber')}`,
    description: 'Emergency change requires immediate approval',
    priority: 'critical',
    dueDate: '1 hour',
    assignTo: {
      roles: ['cto', 'service_owner', 'senior_management']
    },
    contextData: {
      changeId: data.get('changeId'),
      changeNumber: data.get('changeNumber'),
      urgency: 'emergency'
    }
  });
  
  const approvalEvent = await events.waitFor(`Task:${taskId}:Complete`);
  
  if (approvalEvent.payload.approved) {
    await actions.approveChange({
      changeId: data.get('changeId'),
      approvedBy: approvalEvent.user_id,
      approvalType: 'emergency_expedited',
      notes: 'Emergency expedited approval due to urgency'
    });
    
    context.setState('approved');
  } else {
    await actions.rejectChange({
      changeId: data.get('changeId'),
      rejectedBy: approvalEvent.user_id,
      reason: approvalEvent.payload.rejectionReason
    });
    
    context.setState('rejected');
  }
}

export { cabApprovalWorkflow, emergencyCABWorkflow };