/**
 * ITIL Incident Lifecycle Workflow
 *
 * Manages the complete lifecycle of an ITIL incident from creation to closure,
 * including automatic priority calculation, SLA monitoring, and proper state transitions.
 *
 * @param context The workflow context provided by the runtime
 */
export async function itilIncidentLifecycleWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state - Processing
  context.setState('incident_logged');
  
  // The workflow is triggered by a ticket creation event
  const { triggerEvent } = context.input;
  const incidentData = triggerEvent.payload;
  
  // Store incident information
  data.set('incidentId', incidentData.ticket_id);
  data.set('incidentNumber', incidentData.ticket_number);
  data.set('reportedBy', incidentData.entered_by);
  data.set('createdAt', incidentData.entered_at);
  
  logger.info(`Starting ITIL incident lifecycle for ${incidentData.ticket_number}`);
  
  // Step 1: Incident Categorization and Priority Calculation
  await performIncidentCategorization(context, incidentData);
  
  // Step 2: Initial Diagnosis and Assignment
  context.setState('in_progress');
  await performInitialDiagnosis(context);
  
  // Step 3: Investigation and Diagnosis Loop
  let isResolved = false;
  let investigationAttempts = 0;
  const maxInvestigationAttempts = 5;
  
  while (!isResolved && investigationAttempts < maxInvestigationAttempts) {
    investigationAttempts++;
    logger.info(`Investigation attempt ${investigationAttempts}`);
    
    const investigationResult = await performInvestigation(context);
    
    if (investigationResult.resolved) {
      isResolved = true;
      await finalizeResolution(context, investigationResult);
    } else if (investigationResult.escalate) {
      await escalateIncident(context, investigationResult.escalationReason);
    } else if (investigationResult.needsMoreInfo) {
      await requestAdditionalInformation(context);
      // Wait for response
      await events.waitFor(`Ticket:${data.get('incidentId')}:Updated`);
    }
  }
  
  if (!isResolved) {
    // Maximum investigation attempts reached, escalate to management
    await escalateIncident(context, 'Maximum investigation attempts reached');
    
    // Wait for manual resolution
    const resolutionEvent = await events.waitFor(`Ticket:${data.get('incidentId')}:Resolved`);
    await finalizeResolution(context, resolutionEvent.payload);
  }
  
  // Step 4: Closure Process
  context.setState('resolved');
  await performIncidentClosure(context);
  
  context.setState('closed');
  logger.info('ITIL incident lifecycle completed');
}

/**
 * Perform incident categorization and priority calculation
 */
async function performIncidentCategorization(context: any, incidentData: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Performing incident categorization and priority calculation');
  
  // Calculate ITIL priority if impact and urgency are provided
  if (incidentData.itil_impact && incidentData.itil_urgency) {
    const calculatedPriority = await actions.calculateItilPriority({
      impact: incidentData.itil_impact,
      urgency: incidentData.itil_urgency
    });
    
    // Update incident with calculated priority
    await actions.updateTicket({
      ticketId: data.get('incidentId'),
      priority: calculatedPriority.level,
      slaTarget: calculatedPriority.slaHours + ' hours'
    });
    
    data.set('calculatedPriority', calculatedPriority.level);
    data.set('slaTargetHours', calculatedPriority.slaHours);
  }
  
  // Auto-categorize based on keywords if not already categorized
  if (!incidentData.itil_category) {
    const autoCategory = await actions.autoCategorizePatch(incidentData.title + ' ' + incidentData.description);
    
    if (autoCategory.category) {
      await actions.updateTicket({
        ticketId: data.get('incidentId'),
        itilCategory: autoCategory.category,
        itilSubcategory: autoCategory.subcategory
      });
    }
  }
  
  // Start escalation monitoring workflow
  await actions.startWorkflow({
    workflowType: 'itilEscalationWorkflow',
    input: {
      triggerEvent: {
        type: 'Ticket:Created',
        payload: incidentData
      }
    }
  });
}

/**
 * Perform initial diagnosis and assignment
 */
async function performInitialDiagnosis(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Performing initial diagnosis and assignment');
  
  // Create initial diagnosis task
  const { taskId } = await actions.createHumanTask({
    taskType: 'initial_diagnosis',
    title: `Initial Diagnosis - ${data.get('incidentNumber')}`,
    description: 'Perform initial diagnosis and determine resolution approach',
    priority: data.get('calculatedPriority') === 1 ? 'critical' : 'high',
    dueDate: data.get('calculatedPriority') === 1 ? '30 minutes' : '2 hours',
    assignTo: {
      rules: 'auto_assign_by_category',
      fallback: ['level1_support']
    },
    contextData: {
      incidentId: data.get('incidentId'),
      incidentNumber: data.get('incidentNumber'),
      phase: 'initial_diagnosis'
    }
  });
  
  // Wait for diagnosis completion
  const diagnosisEvent = await context.events.waitFor(`Task:${taskId}:Complete`);
  data.set('initialDiagnosis', diagnosisEvent.payload);
  
  // Update incident with diagnosis information
  await actions.updateTicket({
    ticketId: data.get('incidentId'),
    assignedTo: diagnosisEvent.user_id,
    attributes: {
      initialDiagnosis: diagnosisEvent.payload,
      diagnosisTimestamp: diagnosisEvent.timestamp
    }
  });
}

/**
 * Perform investigation and resolution attempt
 */
async function performInvestigation(context: any): Promise<any> {
  const { actions, data, logger, events } = context;
  
  logger.info('Performing investigation');
  
  // Create investigation task
  const { taskId } = await actions.createHumanTask({
    taskType: 'incident_investigation',
    title: `Investigation - ${data.get('incidentNumber')}`,
    description: 'Investigate and attempt to resolve the incident',
    priority: data.get('calculatedPriority') <= 2 ? 'high' : 'medium',
    dueDate: data.get('calculatedPriority') === 1 ? '1 hour' : '4 hours',
    assignTo: {
      userId: data.get('assignedTechnician')
    },
    contextData: {
      incidentId: data.get('incidentId'),
      incidentNumber: data.get('incidentNumber'),
      phase: 'investigation',
      previousAttempts: data.get('investigationAttempts') || []
    }
  });
  
  // Wait for investigation completion
  const investigationEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const result = investigationEvent.payload;
  
  // Store investigation results
  const attempts = data.get('investigationAttempts') || [];
  attempts.push({
    timestamp: investigationEvent.timestamp,
    technician: investigationEvent.user_id,
    result: result,
    actions: result.actionsTaken
  });
  data.set('investigationAttempts', attempts);
  
  return result;
}

/**
 * Finalize incident resolution
 */
async function finalizeResolution(context: any, resolutionData: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Finalizing incident resolution');
  
  // Update incident with resolution information
  await actions.updateTicket({
    ticketId: data.get('incidentId'),
    resolutionCode: resolutionData.resolutionCode,
    rootCause: resolutionData.rootCause,
    workaround: resolutionData.workaround,
    resolvedBy: resolutionData.resolvedBy,
    resolvedAt: new Date().toISOString()
  });
  
  // Check if this should create a problem record
  if (resolutionData.createProblem) {
    await actions.createProblemRecord({
      title: `Problem - ${data.get('incidentNumber')}`,
      description: resolutionData.problemDescription,
      relatedIncidents: [data.get('incidentId')],
      rootCause: resolutionData.rootCause,
      priority: data.get('calculatedPriority')
    });
  }
  
  // Send resolution notification to customer
  await actions.sendNotification({
    recipient: data.get('reportedBy'),
    template: 'incident_resolved',
    data: {
      incidentNumber: data.get('incidentNumber'),
      resolutionCode: resolutionData.resolutionCode,
      resolutionSummary: resolutionData.summary
    }
  });
}

/**
 * Escalate incident to higher level
 */
async function escalateIncident(context: any, reason: string): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info(`Escalating incident: ${reason}`);
  
  const currentLevel = data.get('escalationLevel') || 1;
  const newLevel = currentLevel + 1;
  
  await actions.updateTicket({
    ticketId: data.get('incidentId'),
    escalated: true,
    escalationLevel: newLevel,
    escalatedAt: new Date().toISOString(),
    escalatedBy: 'workflow'
  });
  
  // Create escalation task
  await actions.createHumanTask({
    taskType: 'incident_escalation',
    title: `Escalated Incident - ${data.get('incidentNumber')}`,
    description: `Incident escalated to Level ${newLevel}. Reason: ${reason}`,
    priority: 'high',
    dueDate: '1 hour',
    assignTo: {
      roles: [`level${newLevel}_support`, 'team_lead']
    },
    contextData: {
      incidentId: data.get('incidentId'),
      escalationLevel: newLevel,
      escalationReason: reason
    }
  });
  
  data.set('escalationLevel', newLevel);
}

/**
 * Request additional information from customer
 */
async function requestAdditionalInformation(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Requesting additional information');
  
  await actions.sendNotification({
    recipient: data.get('reportedBy'),
    template: 'request_additional_info',
    data: {
      incidentNumber: data.get('incidentNumber'),
      requestedInfo: 'Please provide additional details about the issue'
    }
  });
  
  // Update ticket status to pending customer
  await actions.updateTicket({
    ticketId: data.get('incidentId'),
    status: 'pending_customer'
  });
}

/**
 * Perform incident closure process
 */
async function performIncidentClosure(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Performing incident closure');
  
  // Send closure notification to customer
  await actions.sendNotification({
    recipient: data.get('reportedBy'),
    template: 'incident_closed',
    data: {
      incidentNumber: data.get('incidentNumber'),
      resolutionSummary: data.get('resolutionSummary')
    }
  });
  
  // Create customer satisfaction survey task
  await actions.createCustomerSurvey({
    type: 'incident_satisfaction',
    incidentId: data.get('incidentId'),
    customerId: data.get('reportedBy'),
    questions: [
      'How satisfied are you with the resolution time?',
      'How satisfied are you with the quality of service?',
      'Would you like to provide any additional feedback?'
    ]
  });
  
  // Update final incident status
  await actions.updateTicket({
    ticketId: data.get('incidentId'),
    status: 'closed',
    closedAt: new Date().toISOString(),
    closedBy: 'workflow'
  });
}

export { itilIncidentLifecycleWorkflow };