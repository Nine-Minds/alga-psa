/**
 * Problem Lifecycle Management Workflow
 *
 * Manages the complete ITIL Problem lifecycle from identification to closure.
 * Ensures proper state transitions and compliance with ITIL processes.
 *
 * @param context The workflow context provided by the runtime
 */
export async function problemLifecycleWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state - Problem Logged
  context.setState('problem_logged');
  
  // The workflow is triggered by a problem creation event
  const { triggerEvent } = context.input;
  const problemData = triggerEvent.payload;
  
  // Store problem information
  data.set('problemId', problemData.problem_id);
  data.set('problemNumber', problemData.problem_number);
  data.set('problemType', problemData.problem_type);
  data.set('createdBy', problemData.created_by);
  data.set('createdAt', problemData.created_at);
  
  logger.info(`Starting problem lifecycle for ${problemData.problem_number}`);
  
  // Phase 1: Problem Classification and Assignment
  await classifyAndAssignProblem(context);
  
  // Phase 2: Investigation Management
  await manageInvestigation(context);
  
  // Phase 3: Solution Development
  await developSolution(context);
  
  // Phase 4: Implementation Oversight
  await overseeImplementation(context);
  
  // Phase 5: Closure Process
  await processClosure(context);
  
  context.setState('problem_closed');
  logger.info('Problem lifecycle workflow completed');
}

/**
 * Phase 1: Problem Classification and Assignment
 */
async function classifyAndAssignProblem(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting problem classification and assignment');
  context.setState('classifying_problem');
  
  // Create classification task
  const { taskId } = await actions.createHumanTask({
    taskType: 'problem_classification',
    title: `Classify and Assign Problem - ${data.get('problemNumber')}`,
    description: 'Review, classify, and assign the problem for investigation',
    priority: 'high',
    dueDate: '1 day',
    assignTo: {
      roles: ['problem_manager', 'service_desk_manager']
    },
    contextData: {
      problemId: data.get('problemId'),
      problemNumber: data.get('problemNumber'),
      problemType: data.get('problemType'),
      phase: 'classification',
      classificationCriteria: [
        'Priority assessment based on business impact',
        'Category assignment',
        'Resource allocation',
        'Investigation team assignment',
        'Initial timeline estimation'
      ]
    }
  });
  
  // Wait for classification completion
  const classificationEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const classificationResults = classificationEvent.payload;
  
  // Update problem with classification results
  await actions.updateProblem({
    problemId: data.get('problemId'),
    status_id: 'assigned',
    priority_id: classificationResults.priorityId,
    category_id: classificationResults.categoryId,
    assigned_to: classificationResults.assignedTo,
    problem_manager: classificationResults.problemManager,
    investigation_team: classificationResults.investigationTeam,
    business_impact: classificationResults.businessImpact,
    estimated_cost: classificationResults.estimatedCost
  });
  
  // Store classification results
  data.set('classification', {
    timestamp: classificationEvent.timestamp,
    classifier: classificationEvent.user_id,
    priority: classificationResults.priorityId,
    assignedTo: classificationResults.assignedTo,
    problemManager: classificationResults.problemManager,
    investigationTeam: classificationResults.investigationTeam,
    estimatedEffort: classificationResults.estimatedEffort
  });
  
  // Send assignment notifications
  const notifications = [];
  if (classificationResults.assignedTo) {
    notifications.push({
      recipient: classificationResults.assignedTo,
      template: 'problem_assigned',
      data: {
        problemNumber: data.get('problemNumber'),
        assignedBy: classificationEvent.user_id
      }
    });
  }
  
  if (classificationResults.investigationTeam?.length > 0) {
    notifications.push(...classificationResults.investigationTeam.map(memberId => ({
      recipient: memberId,
      template: 'investigation_team_assignment',
      data: {
        problemNumber: data.get('problemNumber'),
        role: 'investigation_team_member'
      }
    })));
  }
  
  await Promise.all(notifications.map(notif => actions.sendNotification(notif)));
  
  context.setState('problem_assigned');
}

/**
 * Phase 2: Investigation Management
 */
async function manageInvestigation(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting investigation management');
  context.setState('under_investigation');
  
  const classification = data.get('classification');
  
  // Update problem status
  await actions.updateProblem({
    problemId: data.get('problemId'),
    status_id: 'under_investigation',
    investigation_started_at: new Date().toISOString()
  });
  
  // Start the problem analysis workflow
  const analysisWorkflowId = await actions.startWorkflow({
    workflowType: 'problemAnalysisWorkflow',
    input: {
      triggerEvent: {
        type: 'Problem:Investigation_Started',
        payload: {
          problem_id: data.get('problemId'),
          problem_number: data.get('problemNumber'),
          problem_type: data.get('problemType')
        }
      }
    }
  });
  
  data.set('analysisWorkflowId', analysisWorkflowId);
  
  // Set up investigation monitoring
  let investigationComplete = false;
  let investigationAttempts = 0;
  const maxInvestigationTime = 30; // 30 days maximum
  
  while (!investigationComplete && investigationAttempts < maxInvestigationTime) {
    // Wait for either analysis completion or daily check-in
    const result = await Promise.race([
      events.waitFor(`Workflow:${analysisWorkflowId}:Completed`),
      events.waitForTimeout(24 * 60 * 60 * 1000) // 24 hours
    ]);
    
    if (result?.type === 'Workflow:Completed') {
      investigationComplete = true;
      data.set('analysisResults', result.payload);
    } else {
      // Daily check-in
      investigationAttempts++;
      
      // Create progress review task every 7 days
      if (investigationAttempts % 7 === 0) {
        await actions.createHumanTask({
          taskType: 'investigation_progress_review',
          title: `Investigation Progress Review - ${data.get('problemNumber')}`,
          description: `Weekly progress review for problem investigation (Day ${investigationAttempts})`,
          priority: 'medium',
          dueDate: '1 day',
          assignTo: {
            userId: classification.problemManager
          },
          contextData: {
            problemId: data.get('problemId'),
            investigationDays: investigationAttempts,
            analysisWorkflowId
          }
        });
      }
      
      // Escalate if investigation is taking too long
      if (investigationAttempts >= 21) { // 3 weeks
        await actions.sendNotification({
          recipients: ['service_owner', 'senior_management'],
          template: 'problem_investigation_escalation',
          data: {
            problemNumber: data.get('problemNumber'),
            investigationDays: investigationAttempts,
            problemManager: classification.problemManager
          }
        });
      }
    }
  }
  
  if (!investigationComplete) {
    // Investigation timeout - escalate to management
    await actions.createHumanTask({
      taskType: 'investigation_timeout_review',
      title: `Investigation Timeout - ${data.get('problemNumber')}`,
      description: 'Problem investigation has exceeded maximum timeframe. Management review required.',
      priority: 'critical',
      dueDate: '2 days',
      assignTo: {
        roles: ['senior_management', 'service_owner']
      },
      contextData: {
        problemId: data.get('problemId'),
        investigationDays: investigationAttempts,
        analysisWorkflowId
      }
    });
  }
}

/**
 * Phase 3: Solution Development
 */
async function developSolution(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting solution development');
  context.setState('solution_development');
  
  const analysisResults = data.get('analysisResults');
  
  // Create solution development task
  const { taskId } = await actions.createHumanTask({
    taskType: 'solution_development',
    title: `Develop Solution - ${data.get('problemNumber')}`,
    description: 'Develop and validate the permanent solution',
    priority: 'high',
    dueDate: '7 days',
    assignTo: {
      roles: ['solution_architect', 'technical_lead', 'problem_manager']
    },
    contextData: {
      problemId: data.get('problemId'),
      problemNumber: data.get('problemNumber'),
      analysisResults: analysisResults,
      phase: 'solution_development',
      deliverables: [
        'Detailed solution design',
        'Implementation plan',
        'Risk assessment',
        'Test plan',
        'Rollback plan',
        'Resource requirements'
      ]
    }
  });
  
  // Wait for solution development completion
  const solutionEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const solutionResults = solutionEvent.payload;
  
  // Store solution results
  data.set('solutionDevelopment', {
    timestamp: solutionEvent.timestamp,
    developer: solutionEvent.user_id,
    solution: solutionResults.solution,
    implementationPlan: solutionResults.implementationPlan,
    riskAssessment: solutionResults.riskAssessment,
    testPlan: solutionResults.testPlan,
    resourceRequirements: solutionResults.resourceRequirements
  });
  
  // Update problem with solution
  await actions.updateProblem({
    problemId: data.get('problemId'),
    permanent_solution: solutionResults.solution,
    status_id: 'resolved'
  });
  
  // Create change request if needed
  if (solutionResults.requiresChange) {
    const changeRequest = await actions.createChangeRequest({
      title: `Problem Resolution - ${data.get('problemNumber')}`,
      description: solutionResults.solution,
      justification: `Permanent fix for problem ${data.get('problemNumber')}`,
      problemId: data.get('problemId'),
      changeType: solutionResults.changeType || 'normal',
      priority: solutionResults.changePriority || 'high',
      implementationPlan: solutionResults.implementationPlan,
      riskAssessment: solutionResults.riskAssessment,
      testPlan: solutionResults.testPlan,
      rollbackPlan: solutionResults.rollbackPlan
    });
    
    data.set('changeRequestId', changeRequest.id);
    
    // Update problem with change request reference
    await actions.updateProblem({
      problemId: data.get('problemId'),
      related_change_ids: [changeRequest.id]
    });
  }
  
  context.setState('solution_developed');
}

/**
 * Phase 4: Implementation Oversight
 */
async function overseeImplementation(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting implementation oversight');
  context.setState('implementation_oversight');
  
  const solutionDevelopment = data.get('solutionDevelopment');
  const changeRequestId = data.get('changeRequestId');
  
  if (changeRequestId) {
    // Monitor change request progress
    let changeComplete = false;
    
    while (!changeComplete) {
      const changeStatus = await actions.getChangeRequestStatus(changeRequestId);
      
      if (changeStatus.status === 'implemented') {
        changeComplete = true;
        
        // Update problem
        await actions.updateProblem({
          problemId: data.get('problemId'),
          solution_implemented_at: new Date().toISOString(),
          status_id: 'resolved'
        });
        
      } else if (changeStatus.status === 'failed' || changeStatus.status === 'cancelled') {
        // Change failed - create manual intervention task
        await actions.createHumanTask({
          taskType: 'change_failure_resolution',
          title: `Change Failed - Manual Resolution Required - ${data.get('problemNumber')}`,
          description: 'Associated change request failed. Manual intervention required.',
          priority: 'critical',
          dueDate: '1 day',
          assignTo: {
            roles: ['problem_manager', 'change_manager']
          },
          contextData: {
            problemId: data.get('problemId'),
            changeRequestId,
            changeStatus: changeStatus.status,
            failureReason: changeStatus.failureReason
          }
        });
        
        // Wait for manual intervention
        await events.waitFor(`Task:Change_Failure_Resolution:Complete`);
        changeComplete = true;
        
      } else {
        // Wait and check again
        await events.waitForTimeout(4 * 60 * 60 * 1000); // Check every 4 hours
      }
    }
  } else {
    // No change request required - solution can be implemented directly
    await actions.createHumanTask({
      taskType: 'direct_solution_implementation',
      title: `Implement Solution - ${data.get('problemNumber')}`,
      description: 'Implement the problem solution directly',
      priority: 'high',
      dueDate: '3 days',
      assignTo: {
        userId: solutionDevelopment.developer
      },
      contextData: {
        problemId: data.get('problemId'),
        solution: solutionDevelopment.solution,
        implementationPlan: solutionDevelopment.implementationPlan
      }
    });
    
    const implementationEvent = await events.waitFor(`Task:Direct_Solution_Implementation:Complete`);
    
    // Update problem
    await actions.updateProblem({
      problemId: data.get('problemId'),
      solution_implemented_at: new Date().toISOString(),
      status_id: 'resolved',
      resolved_by: implementationEvent.user_id,
      resolved_at: new Date().toISOString()
    });
  }
  
  context.setState('solution_implemented');
}

/**
 * Phase 5: Closure Process
 */
async function processClosure(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting closure process');
  context.setState('closing_problem');
  
  // Create closure task
  const { taskId } = await actions.createHumanTask({
    taskType: 'problem_closure',
    title: `Close Problem - ${data.get('problemNumber')}`,
    description: 'Review and close the problem record',
    priority: 'medium',
    dueDate: '5 days',
    assignTo: {
      roles: ['problem_manager']
    },
    contextData: {
      problemId: data.get('problemId'),
      problemNumber: data.get('problemNumber'),
      phase: 'closure',
      closureCriteria: [
        'Solution effectiveness verified',
        'No recurrence observed',
        'All related incidents resolved',
        'Documentation complete',
        'Lessons learned documented',
        'Known error status updated if applicable'
      ]
    }
  });
  
  // Wait for closure completion
  const closureEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const closureResults = closureEvent.payload;
  
  // Update problem with closure information
  await actions.updateProblem({
    problemId: data.get('problemId'),
    status_id: 'closed',
    closed_by: closureEvent.user_id,
    closed_at: new Date().toISOString(),
    closure_code: closureResults.closureCode,
    closure_notes: closureResults.closureNotes,
    lessons_learned: closureResults.lessonsLearned
  });
  
  // Create post-implementation review task
  await actions.createHumanTask({
    taskType: 'post_implementation_review',
    title: `Post-Implementation Review - ${data.get('problemNumber')}`,
    description: 'Conduct post-implementation review and capture lessons learned',
    priority: 'low',
    dueDate: '30 days',
    assignTo: {
      roles: ['problem_manager', 'service_owner']
    },
    contextData: {
      problemId: data.get('problemId'),
      closureResults: closureResults,
      reviewPeriod: '30 days'
    }
  });
  
  // Send closure notifications
  await actions.sendNotification({
    recipients: [
      data.get('createdBy'),
      data.get('classification')?.assignedTo,
      data.get('classification')?.problemManager
    ].filter(Boolean),
    template: 'problem_closed',
    data: {
      problemNumber: data.get('problemNumber'),
      closureCode: closureResults.closureCode,
      solution: data.get('solutionDevelopment')?.solution
    }
  });
  
  // Update metrics
  await actions.updateProblemMetrics({
    problemId: data.get('problemId'),
    lifecycleDuration: calculateLifecycleDuration(
      data.get('createdAt'),
      new Date().toISOString()
    )
  });
}

/**
 * Helper function to calculate lifecycle duration
 */
function calculateLifecycleDuration(startTime: string, endTime: string): number {
  const start = new Date(startTime);
  const end = new Date(endTime);
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60); // Hours
}

export { problemLifecycleWorkflow };