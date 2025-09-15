/**
 * Problem Analysis Workflow
 *
 * Manages the root cause analysis process for ITIL problems.
 * Guides teams through systematic investigation and analysis.
 *
 * @param context The workflow context provided by the runtime
 */
export async function problemAnalysisWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state - Starting analysis
  context.setState('analysis_initiated');
  
  // The workflow is triggered by a problem creation or analysis request
  const { triggerEvent } = context.input;
  const problemData = triggerEvent.payload;
  
  // Store problem information
  data.set('problemId', problemData.problem_id);
  data.set('problemNumber', problemData.problem_number);
  data.set('problemType', problemData.problem_type);
  data.set('analysisStarted', new Date().toISOString());
  
  logger.info(`Starting problem analysis for ${problemData.problem_number}`);
  
  // Phase 1: Initial Information Gathering
  await performInitialDataGathering(context);
  
  // Phase 2: Root Cause Analysis
  await performRootCauseAnalysis(context);
  
  // Phase 3: Impact Assessment
  await performImpactAssessment(context);
  
  // Phase 4: Solution Design
  await performSolutionDesign(context);
  
  // Phase 5: Review and Approval
  await performAnalysisReview(context);
  
  // Phase 6: Implementation Planning
  await planImplementation(context);
  
  context.setState('analysis_completed');
  logger.info('Problem analysis workflow completed');
}

/**
 * Phase 1: Initial Information Gathering
 */
async function performInitialDataGathering(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting initial data gathering phase');
  context.setState('gathering_information');
  
  // Create information gathering task
  const { taskId } = await actions.createHumanTask({
    taskType: 'problem_data_gathering',
    title: `Information Gathering - ${data.get('problemNumber')}`,
    description: 'Collect all relevant information about the problem and its symptoms',
    priority: 'high',
    dueDate: '2 days',
    assignTo: {
      roles: ['problem_analyst', 'senior_technician']
    },
    contextData: {
      problemId: data.get('problemId'),
      problemNumber: data.get('problemNumber'),
      phase: 'information_gathering',
      checklist: [
        'Collect all related incident records',
        'Gather system logs and error messages',
        'Document timeline of events',
        'Interview affected users and technicians',
        'Review configuration changes',
        'Check monitoring data and alerts',
        'Document environmental factors'
      ]
    }
  });
  
  // Wait for information gathering completion
  const gatheringEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const gatheringResults = gatheringEvent.payload;
  
  // Store gathered information
  data.set('informationGathered', {
    timestamp: gatheringEvent.timestamp,
    analyst: gatheringEvent.user_id,
    findings: gatheringResults.findings,
    timeline: gatheringResults.timeline,
    affectedSystems: gatheringResults.affectedSystems,
    relatedIncidents: gatheringResults.relatedIncidents
  });
  
  // Update problem record with initial findings
  await actions.updateProblem({
    problemId: data.get('problemId'),
    investigation_started_at: data.get('analysisStarted'),
    attributes: {
      initial_findings: gatheringResults.findings,
      affected_systems: gatheringResults.affectedSystems
    }
  });
  
  // Create analysis session record
  await actions.createAnalysisSession({
    problemId: data.get('problemId'),
    analysisType: 'information_gathering',
    leadAnalyst: gatheringEvent.user_id,
    findings: gatheringResults.findings,
    sessionDate: gatheringEvent.timestamp,
    durationMinutes: gatheringResults.durationMinutes
  });
}

/**
 * Phase 2: Root Cause Analysis
 */
async function performRootCauseAnalysis(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting root cause analysis phase');
  context.setState('root_cause_analysis');
  
  const informationGathered = data.get('informationGathered');
  
  // Create root cause analysis task
  const { taskId } = await actions.createHumanTask({
    taskType: 'root_cause_analysis',
    title: `Root Cause Analysis - ${data.get('problemNumber')}`,
    description: 'Perform systematic root cause analysis using appropriate methodologies',
    priority: 'high',
    dueDate: '5 days',
    assignTo: {
      roles: ['problem_manager', 'senior_analyst', 'subject_matter_expert']
    },
    contextData: {
      problemId: data.get('problemId'),
      problemNumber: data.get('problemNumber'),
      phase: 'root_cause_analysis',
      initialFindings: informationGathered.findings,
      suggestedMethods: [
        'Fishbone Diagram (Ishikawa)',
        '5 Whys Analysis',
        'Fault Tree Analysis',
        'Pareto Analysis',
        'Timeline Analysis'
      ],
      analysisTemplate: {
        suspected_causes: [],
        analysis_method: '',
        evidence_supporting: '',
        evidence_against: '',
        root_cause_hypothesis: '',
        validation_steps: []
      }
    }
  });
  
  // Wait for root cause analysis completion
  const rcaEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const rcaResults = rcaEvent.payload;
  
  // Store root cause analysis results
  data.set('rootCauseAnalysis', {
    timestamp: rcaEvent.timestamp,
    analyst: rcaEvent.user_id,
    method: rcaResults.analysisMethod,
    rootCause: rcaResults.rootCause,
    contributingFactors: rcaResults.contributingFactors,
    evidence: rcaResults.evidence,
    confidence: rcaResults.confidence
  });
  
  // Update problem record
  await actions.updateProblem({
    problemId: data.get('problemId'),
    root_cause: rcaResults.rootCause,
    attributes: {
      root_cause_analysis: rcaResults,
      contributing_factors: rcaResults.contributingFactors
    }
  });
  
  // Create analysis session record
  await actions.createAnalysisSession({
    problemId: data.get('problemId'),
    analysisType: 'root_cause_analysis',
    leadAnalyst: rcaEvent.user_id,
    findings: rcaResults.rootCause,
    recommendations: rcaResults.recommendations,
    sessionDate: rcaEvent.timestamp,
    durationMinutes: rcaResults.durationMinutes
  });
  
  // If confidence is low, create additional investigation task
  if (rcaResults.confidence < 0.7) {
    await actions.createHumanTask({
      taskType: 'additional_investigation',
      title: `Additional Investigation Required - ${data.get('problemNumber')}`,
      description: 'Root cause confidence is low. Additional investigation required.',
      priority: 'medium',
      dueDate: '3 days',
      assignTo: {
        roles: ['problem_manager']
      },
      contextData: {
        problemId: data.get('problemId'),
        currentHypothesis: rcaResults.rootCause,
        confidence: rcaResults.confidence,
        additionalSteps: rcaResults.additionalInvestigationSteps
      }
    });
  }
}

/**
 * Phase 3: Impact Assessment
 */
async function performImpactAssessment(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting impact assessment phase');
  context.setState('impact_assessment');
  
  const rootCauseAnalysis = data.get('rootCauseAnalysis');
  
  // Create impact assessment task
  const { taskId } = await actions.createHumanTask({
    taskType: 'impact_assessment',
    title: `Impact Assessment - ${data.get('problemNumber')}`,
    description: 'Assess the business and technical impact of the problem',
    priority: 'high',
    dueDate: '2 days',
    assignTo: {
      roles: ['business_analyst', 'problem_manager', 'service_owner']
    },
    contextData: {
      problemId: data.get('problemId'),
      problemNumber: data.get('problemNumber'),
      rootCause: rootCauseAnalysis.rootCause,
      phase: 'impact_assessment',
      assessmentAreas: [
        'Financial impact',
        'Service availability impact', 
        'User productivity impact',
        'Reputation/customer satisfaction impact',
        'Regulatory/compliance impact',
        'Security impact'
      ]
    }
  });
  
  // Wait for impact assessment completion
  const impactEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const impactResults = impactEvent.payload;
  
  // Store impact assessment results
  data.set('impactAssessment', {
    timestamp: impactEvent.timestamp,
    analyst: impactEvent.user_id,
    financialImpact: impactResults.financialImpact,
    serviceImpact: impactResults.serviceImpact,
    userImpact: impactResults.userImpact,
    riskLevel: impactResults.riskLevel,
    urgencyRating: impactResults.urgencyRating
  });
  
  // Update problem record
  await actions.updateProblem({
    problemId: data.get('problemId'),
    business_impact: impactResults.businessImpact,
    estimated_cost: impactResults.financialImpact.totalCost,
    affected_services: impactResults.affectedServices
  });
  
  // Create analysis session record
  await actions.createAnalysisSession({
    problemId: data.get('problemId'),
    analysisType: 'impact_assessment',
    leadAnalyst: impactEvent.user_id,
    findings: impactResults.summary,
    sessionDate: impactEvent.timestamp,
    durationMinutes: impactResults.durationMinutes
  });
}

/**
 * Phase 4: Solution Design
 */
async function performSolutionDesign(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting solution design phase');
  context.setState('solution_design');
  
  const rootCauseAnalysis = data.get('rootCauseAnalysis');
  const impactAssessment = data.get('impactAssessment');
  
  // Create solution design task
  const { taskId } = await actions.createHumanTask({
    taskType: 'solution_design',
    title: `Solution Design - ${data.get('problemNumber')}`,
    description: 'Design permanent solution to address the root cause',
    priority: 'high',
    dueDate: '5 days',
    assignTo: {
      roles: ['solution_architect', 'problem_manager', 'technical_lead']
    },
    contextData: {
      problemId: data.get('problemId'),
      problemNumber: data.get('problemNumber'),
      rootCause: rootCauseAnalysis.rootCause,
      impactAssessment: impactAssessment,
      phase: 'solution_design',
      solutionTypes: [
        'Configuration change',
        'Software update/patch',
        'Hardware replacement',
        'Process improvement',
        'Training/documentation',
        'Infrastructure change'
      ]
    }
  });
  
  // Wait for solution design completion
  const solutionEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const solutionResults = solutionEvent.payload;
  
  // Store solution design results
  data.set('solutionDesign', {
    timestamp: solutionEvent.timestamp,
    designer: solutionEvent.user_id,
    permanentSolution: solutionResults.permanentSolution,
    temporaryWorkaround: solutionResults.temporaryWorkaround,
    implementationPlan: solutionResults.implementationPlan,
    riskAssessment: solutionResults.riskAssessment,
    resourceRequirements: solutionResults.resourceRequirements
  });
  
  // Update problem record
  await actions.updateProblem({
    problemId: data.get('problemId'),
    permanent_solution: solutionResults.permanentSolution,
    workaround: solutionResults.temporaryWorkaround
  });
  
  // Create analysis session record
  await actions.createAnalysisSession({
    problemId: data.get('problemId'),
    analysisType: 'solution_design',
    leadAnalyst: solutionEvent.user_id,
    findings: solutionResults.permanentSolution,
    recommendations: solutionResults.implementationPlan,
    sessionDate: solutionEvent.timestamp,
    durationMinutes: solutionResults.durationMinutes
  });
}

/**
 * Phase 5: Analysis Review and Approval
 */
async function performAnalysisReview(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  logger.info('Starting analysis review phase');
  context.setState('analysis_review');
  
  const allAnalysisResults = {
    informationGathered: data.get('informationGathered'),
    rootCauseAnalysis: data.get('rootCauseAnalysis'),
    impactAssessment: data.get('impactAssessment'),
    solutionDesign: data.get('solutionDesign')
  };
  
  // Create review task
  const { taskId } = await actions.createHumanTask({
    taskType: 'analysis_review',
    title: `Analysis Review - ${data.get('problemNumber')}`,
    description: 'Review and approve the complete problem analysis',
    priority: 'high',
    dueDate: '2 days',
    assignTo: {
      roles: ['problem_manager', 'service_owner', 'change_manager']
    },
    contextData: {
      problemId: data.get('problemId'),
      problemNumber: data.get('problemNumber'),
      analysisResults: allAnalysisResults,
      phase: 'analysis_review',
      reviewCriteria: [
        'Root cause identification accuracy',
        'Impact assessment completeness',
        'Solution feasibility',
        'Risk assessment adequacy',
        'Implementation plan viability'
      ]
    }
  });
  
  // Wait for review completion
  const reviewEvent = await events.waitFor(`Task:${taskId}:Complete`);
  const reviewResults = reviewEvent.payload;
  
  // Store review results
  data.set('analysisReview', {
    timestamp: reviewEvent.timestamp,
    reviewer: reviewEvent.user_id,
    approved: reviewResults.approved,
    feedback: reviewResults.feedback,
    requiredChanges: reviewResults.requiredChanges
  });
  
  if (!reviewResults.approved) {
    // If not approved, create revision task
    await actions.createHumanTask({
      taskType: 'analysis_revision',
      title: `Analysis Revision Required - ${data.get('problemNumber')}`,
      description: 'Analysis requires revision based on review feedback',
      priority: 'high',
      dueDate: '3 days',
      assignTo: {
        roles: ['problem_analyst']
      },
      contextData: {
        problemId: data.get('problemId'),
        reviewFeedback: reviewResults.feedback,
        requiredChanges: reviewResults.requiredChanges
      }
    });
    
    // Wait for revision
    const revisionEvent = await events.waitFor(`Task:Analysis_Revision:Complete`);
    
    // Restart review process
    await performAnalysisReview(context);
  } else {
    // Analysis approved, update problem status
    await actions.updateProblem({
      problemId: data.get('problemId'),
      investigation_completed_at: new Date().toISOString()
    });
  }
}

/**
 * Phase 6: Implementation Planning
 */
async function planImplementation(context: any): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info('Starting implementation planning phase');
  context.setState('implementation_planning');
  
  const solutionDesign = data.get('solutionDesign');
  const analysisReview = data.get('analysisReview');
  
  // Determine if change management is required
  const requiresChangeManagement = solutionDesign.riskAssessment.level !== 'low' || 
                                   solutionDesign.implementationPlan.complexity === 'high';
  
  if (requiresChangeManagement) {
    // Create change request
    const changeRequest = await actions.createChangeRequest({
      title: `Problem Resolution - ${data.get('problemNumber')}`,
      description: solutionDesign.permanentSolution,
      justification: `Permanent fix for problem ${data.get('problemNumber')}`,
      problemId: data.get('problemId'),
      changeType: 'normal', // Could be 'standard', 'normal', or 'emergency'
      priority: 'high',
      implementationPlan: solutionDesign.implementationPlan,
      riskAssessment: solutionDesign.riskAssessment,
      resourceRequirements: solutionDesign.resourceRequirements
    });
    
    data.set('changeRequestId', changeRequest.id);
    
    // Update problem with change request reference
    await actions.updateProblem({
      problemId: data.get('problemId'),
      related_change_ids: [changeRequest.id]
    });
  }
  
  // If this should become a known error, create KEDB entry
  const shouldCreateKnownError = solutionDesign.temporaryWorkaround && 
                                solutionDesign.riskAssessment.recurrenceRisk === 'high';
  
  if (shouldCreateKnownError) {
    await actions.convertToKnownError({
      problemId: data.get('problemId'),
      title: `Known Error - ${data.get('problemNumber')}`,
      symptoms: data.get('informationGathered').findings,
      workaround: solutionDesign.temporaryWorkaround,
      errorType: determineErrorType(data.get('rootCauseAnalysis').rootCause),
      severity: mapImpactToSeverity(data.get('impactAssessment').riskLevel)
    });
  }
  
  // Send completion notification
  await actions.sendNotification({
    recipients: [analysisReview.reviewer, solutionDesign.designer],
    template: 'problem_analysis_completed',
    data: {
      problemNumber: data.get('problemNumber'),
      rootCause: data.get('rootCauseAnalysis').rootCause,
      solution: solutionDesign.permanentSolution,
      changeRequestId: data.get('changeRequestId')
    }
  });
}

/**
 * Helper function to determine error type based on root cause
 */
function determineErrorType(rootCause: string): 'software' | 'hardware' | 'network' | 'process' | 'environmental' {
  const lowerCause = rootCause.toLowerCase();
  
  if (lowerCause.includes('software') || lowerCause.includes('application') || lowerCause.includes('bug')) {
    return 'software';
  }
  if (lowerCause.includes('hardware') || lowerCause.includes('disk') || lowerCause.includes('memory')) {
    return 'hardware';
  }
  if (lowerCause.includes('network') || lowerCause.includes('connection') || lowerCause.includes('bandwidth')) {
    return 'network';
  }
  if (lowerCause.includes('process') || lowerCause.includes('procedure') || lowerCause.includes('workflow')) {
    return 'process';
  }
  
  return 'environmental';
}

/**
 * Helper function to map impact to severity
 */
function mapImpactToSeverity(riskLevel: string): 'critical' | 'high' | 'medium' | 'low' {
  switch (riskLevel?.toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    default: return 'low';
  }
}

export { problemAnalysisWorkflow };