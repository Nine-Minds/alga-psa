/**
 * ITIL Escalation Workflow
 *
 * Automatically escalates tickets based on ITIL priority and SLA targets.
 * This workflow monitors ticket aging and escalates when SLA thresholds are reached.
 *
 * @param context The workflow context provided by the runtime
 */
export async function itilEscalationWorkflow(context: any): Promise<void> {
  const { actions, events, data, logger } = context;
  
  // Initial state - Processing
  context.setState('monitoring');
  
  // The workflow is triggered by a ticket creation or update event
  const { triggerEvent } = context.input;
  const ticketData = triggerEvent.payload;
  
  // Store ticket information
  data.set('ticketId', ticketData.ticket_id);
  data.set('ticketNumber', ticketData.ticket_number);
  data.set('priority', ticketData.priority);
  data.set('itilImpact', ticketData.itil_impact || 3);
  data.set('itilUrgency', ticketData.itil_urgency || 3);
  data.set('createdAt', ticketData.entered_at);
  data.set('currentEscalationLevel', ticketData.escalation_level || 0);
  
  logger.info(`Starting escalation monitoring for ticket ${ticketData.ticket_number}`);
  
  // Calculate SLA target based on ITIL priority
  const slaTarget = await actions.calculateSlaTarget({
    impact: data.get('itilImpact'),
    urgency: data.get('itilUrgency'),
    priority: data.get('priority')
  });
  
  data.set('slaTargetHours', slaTarget.hours);
  data.set('escalationThresholds', {
    level1: slaTarget.hours * 0.7,  // 70% of SLA target
    level2: slaTarget.hours * 0.9,  // 90% of SLA target
    level3: slaTarget.hours * 1.1   // 110% of SLA target (breached)
  });
  
  // Set up escalation monitoring loop
  let isTicketClosed = false;
  let currentLevel = data.get('currentEscalationLevel');
  
  while (!isTicketClosed) {
    // Wait for either ticket closure or escalation timer
    const escalationThresholds = data.get('escalationThresholds');
    const nextThreshold = getNextEscalationThreshold(currentLevel, escalationThresholds);
    
    if (nextThreshold > 0) {
      // Calculate remaining time until next escalation
      const elapsedHours = calculateElapsedHours(data.get('createdAt'));
      const remainingHours = nextThreshold - elapsedHours;
      
      if (remainingHours > 0) {
        logger.info(`Waiting ${remainingHours} hours for next escalation threshold`);
        
        // Wait for either time threshold or ticket status change
        const result = await Promise.race([
          events.waitForTimeout(remainingHours * 60 * 60 * 1000), // Convert to milliseconds
          events.waitFor(`Ticket:${data.get('ticketId')}:StatusChanged`),
          events.waitFor(`Ticket:${data.get('ticketId')}:Closed`)
        ]);
        
        // Check if ticket was closed
        if (result?.type === 'Ticket:Closed') {
          isTicketClosed = true;
          logger.info('Ticket closed, stopping escalation monitoring');
          break;
        }
        
        // Check if ticket status changed to resolved
        if (result?.type === 'Ticket:StatusChanged' && result.payload.is_closed) {
          isTicketClosed = true;
          logger.info('Ticket resolved, stopping escalation monitoring');
          break;
        }
      }
      
      // Escalate if threshold reached and ticket still open
      if (!isTicketClosed) {
        const newLevel = getEscalationLevel(elapsedHours, escalationThresholds);
        
        if (newLevel > currentLevel) {
          await performEscalation(context, newLevel, data.get('ticketId'));
          currentLevel = newLevel;
          data.set('currentEscalationLevel', currentLevel);
        }
      }
    } else {
      // No more escalation levels, monitor for closure only
      logger.info('Maximum escalation level reached, monitoring for closure only');
      
      const result = await events.waitFor(`Ticket:${data.get('ticketId')}:Closed`);
      isTicketClosed = true;
    }
  }
  
  context.setState('completed');
  logger.info('Escalation workflow completed');
}

/**
 * Perform escalation to the specified level
 */
async function performEscalation(context: any, escalationLevel: number, ticketId: string): Promise<void> {
  const { actions, data, logger } = context;
  
  logger.info(`Escalating ticket to level ${escalationLevel}`);
  
  // Update ticket with escalation information
  await actions.updateTicket({
    ticketId,
    escalated: true,
    escalationLevel,
    escalatedAt: new Date().toISOString(),
    escalatedBy: 'system' // System-triggered escalation
  });
  
  // Determine escalation actions based on level
  switch (escalationLevel) {
    case 1:
      // Level 1: Notify assigned technician and team lead
      await actions.sendNotification({
        recipients: await getEscalationRecipients(ticketId, 1),
        template: 'ticket_escalation_level1',
        data: {
          ticketId,
          ticketNumber: data.get('ticketNumber'),
          escalationLevel: 1,
          slaTarget: data.get('slaTargetHours')
        }
      });
      break;
      
    case 2:
      // Level 2: Notify manager and create high-priority alert
      await actions.sendNotification({
        recipients: await getEscalationRecipients(ticketId, 2),
        template: 'ticket_escalation_level2',
        data: {
          ticketId,
          ticketNumber: data.get('ticketNumber'),
          escalationLevel: 2,
          slaTarget: data.get('slaTargetHours')
        }
      });
      
      // Create escalation task for manager review
      await actions.createHumanTask({
        taskType: 'escalation_review',
        title: `Review Escalated Ticket ${data.get('ticketNumber')}`,
        description: `Ticket has been escalated to Level 2. Manager review required.`,
        priority: 'high',
        dueDate: '2 hours',
        assignTo: {
          roles: ['manager', 'team_lead']
        },
        contextData: {
          ticketId,
          escalationLevel: 2,
          escalationReason: 'SLA threshold reached'
        }
      });
      break;
      
    case 3:
      // Level 3: Notify director, mark SLA as breached
      await actions.updateTicket({
        ticketId,
        slaBreach: true
      });
      
      await actions.sendNotification({
        recipients: await getEscalationRecipients(ticketId, 3),
        template: 'ticket_escalation_level3_sla_breach',
        data: {
          ticketId,
          ticketNumber: data.get('ticketNumber'),
          escalationLevel: 3,
          slaTarget: data.get('slaTargetHours'),
          breached: true
        }
      });
      
      // Create critical escalation task for director
      await actions.createHumanTask({
        taskType: 'critical_escalation',
        title: `Critical Escalation - SLA Breach: ${data.get('ticketNumber')}`,
        description: `SLA has been breached for ticket ${data.get('ticketNumber')}. Immediate attention required.`,
        priority: 'critical',
        dueDate: '30 minutes',
        assignTo: {
          roles: ['director', 'manager']
        },
        contextData: {
          ticketId,
          escalationLevel: 3,
          escalationReason: 'SLA breach',
          slaBreach: true
        }
      });
      break;
  }
}

/**
 * Get escalation recipients based on level
 */
async function getEscalationRecipients(ticketId: string, level: number): Promise<string[]> {
  // This would typically query the database to get appropriate escalation contacts
  // For now, return role-based recipients
  const roleMap = {
    1: ['assigned_technician', 'team_lead'],
    2: ['team_lead', 'manager'],
    3: ['manager', 'director', 'service_desk_manager']
  };
  
  return roleMap[level] || [];
}

/**
 * Calculate elapsed hours since ticket creation
 */
function calculateElapsedHours(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  return (now.getTime() - created.getTime()) / (1000 * 60 * 60);
}

/**
 * Get the next escalation threshold based on current level
 */
function getNextEscalationThreshold(currentLevel: number, thresholds: any): number {
  switch (currentLevel) {
    case 0: return thresholds.level1;
    case 1: return thresholds.level2;
    case 2: return thresholds.level3;
    default: return 0; // No more escalations
  }
}

/**
 * Calculate current escalation level based on elapsed time
 */
function getEscalationLevel(elapsedHours: number, thresholds: any): number {
  if (elapsedHours >= thresholds.level3) return 3;
  if (elapsedHours >= thresholds.level2) return 2;
  if (elapsedHours >= thresholds.level1) return 1;
  return 0;
}