import { Knex } from 'knex';
import { ITicket } from '../../interfaces/ticket.interfaces';
import { 
  calculateItilPriority, 
  getSlaTarget, 
  isSlaBreached, 
  getEscalationLevel,
  ItilCategories 
} from '../utils/itilUtils';

export class ItilService {
  constructor(private knex: Knex) {}

  /**
   * Calculate and update ITIL priority for a ticket
   */
  async updateTicketPriority(ticketId: string, impact: number, urgency: number): Promise<void> {
    try {
      const priority = calculateItilPriority(impact, urgency);
      const slaHours = getSlaTarget(priority);
      
      await this.knex('tickets')
        .where('ticket_id', ticketId)
        .update({
          itil_impact: impact,
          itil_urgency: urgency,
          priority_id: this.mapPriorityToId(priority),
          sla_target: `${slaHours} hours`,
          updated_at: this.knex.fn.now()
        });
    } catch (error) {
      console.error('Error updating ticket priority:', error);
      throw error;
    }
  }

  /**
   * Check and update SLA breach status for tickets
   */
  async checkSlaBreaches(): Promise<string[]> {
    try {
      const openTickets = await this.knex('tickets')
        .select('ticket_id', 'ticket_number', 'entered_at', 'itil_impact', 'itil_urgency', 'sla_breach')
        .whereIn('status_id', function() {
          this.select('status_id')
            .from('statuses')
            .where('is_closed', false);
        })
        .where('sla_breach', false);

      const breachedTickets: string[] = [];
      const now = new Date();

      for (const ticket of openTickets) {
        if (ticket.itil_impact && ticket.itil_urgency && ticket.entered_at) {
          const priority = calculateItilPriority(ticket.itil_impact, ticket.itil_urgency);
          const enteredAt = new Date(ticket.entered_at);
          const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
          
          if (isSlaBreached(priority, elapsedHours)) {
            // Update ticket as breached
            await this.knex('tickets')
              .where('ticket_id', ticket.ticket_id)
              .update({
                sla_breach: true,
                updated_at: this.knex.fn.now()
              });
            
            breachedTickets.push(ticket.ticket_number);
          }
        }
      }

      return breachedTickets;
    } catch (error) {
      console.error('Error checking SLA breaches:', error);
      throw error;
    }
  }

  /**
   * Get tickets requiring escalation
   */
  async getTicketsForEscalation(): Promise<ITicket[]> {
    try {
      const tickets = await this.knex('tickets')
        .select('*')
        .whereIn('status_id', function() {
          this.select('status_id')
            .from('statuses')
            .where('is_closed', false);
        })
        .where('escalated', false)
        .whereNotNull('itil_impact')
        .whereNotNull('itil_urgency');

      const ticketsForEscalation: ITicket[] = [];
      const now = new Date();

      for (const ticket of tickets) {
        const priority = calculateItilPriority(ticket.itil_impact!, ticket.itil_urgency!);
        const enteredAt = new Date(ticket.entered_at);
        const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
        
        const escalationLevel = getEscalationLevel(priority, elapsedHours);
        
        if (escalationLevel > 0) {
          ticketsForEscalation.push(ticket);
        }
      }

      return ticketsForEscalation;
    } catch (error) {
      console.error('Error getting tickets for escalation:', error);
      throw error;
    }
  }

  /**
   * Auto-categorize ticket based on keywords
   */
  async autoCategorizeTicket(ticketId: string, title: string, description: string): Promise<void> {
    try {
      const content = `${title} ${description}`.toLowerCase();
      
      // Simple keyword-based categorization
      let category = '';
      let subcategory = '';
      
      // Hardware keywords
      if (content.match(/\b(server|hardware|disk|memory|cpu|motherboard|power|fan)\b/)) {
        category = 'Hardware';
        if (content.match(/\bserver\b/)) subcategory = 'Server';
        else if (content.match(/\b(laptop|desktop|computer|pc)\b/)) subcategory = 'Desktop/Laptop';
        else if (content.match(/\b(printer|print)\b/)) subcategory = 'Printer';
        else if (content.match(/\b(disk|storage|drive|ssd|hdd)\b/)) subcategory = 'Storage';
      }
      // Software keywords
      else if (content.match(/\b(software|application|app|program|install|update|patch|bug)\b/)) {
        category = 'Software';
        if (content.match(/\b(database|sql|db)\b/)) subcategory = 'Database';
        else if (content.match(/\b(windows|linux|mac|os|operating system)\b/)) subcategory = 'Operating System';
        else if (content.match(/\b(office|word|excel|powerpoint|outlook)\b/)) subcategory = 'Productivity Software';
        else subcategory = 'Application';
      }
      // Network keywords
      else if (content.match(/\b(network|internet|connection|wifi|vpn|dns|ip)\b/)) {
        category = 'Network';
        if (content.match(/\bvpn\b/)) subcategory = 'VPN';
        else if (content.match(/\b(wifi|wireless)\b/)) subcategory = 'Wi-Fi';
        else if (content.match(/\b(internet|web)\b/)) subcategory = 'Internet';
        else subcategory = 'Connectivity';
      }
      // Security keywords
      else if (content.match(/\b(virus|malware|security|hack|breach|phishing|password|login|access)\b/)) {
        category = 'Security';
        if (content.match(/\b(virus|malware|ransomware)\b/)) subcategory = 'Malware';
        else if (content.match(/\bphishing\b/)) subcategory = 'Phishing';
        else if (content.match(/\b(password|login|locked)\b/)) subcategory = 'Account Lockout';
        else if (content.match(/\baccess\b/)) subcategory = 'Unauthorized Access';
      }
      // Service Request keywords
      else if (content.match(/\b(request|need|setup|install|create|add|new user)\b/)) {
        category = 'Service Request';
        if (content.match(/\b(new user|onboard|setup user)\b/)) subcategory = 'New User Setup';
        else if (content.match(/\b(access|permission)\b/)) subcategory = 'Access Request';
        else if (content.match(/\binstall\b/)) subcategory = 'Software Installation';
        else if (content.match(/\b(equipment|hardware)\b/)) subcategory = 'Equipment Request';
      }

      if (category) {
        // NOTE: ITIL categories are now stored in the unified category_id field
        // This service should be updated to use the CategoryPicker integration
        // For now, this auto-categorization is disabled to prevent conflicts
        console.log('Auto-categorization detected:', { category, subcategory });
        // TODO: Implement unified category assignment
      }
    } catch (error) {
      console.error('Error auto-categorizing ticket:', error);
      throw error;
    }
  }

  /**
   * Get ITIL metrics for reporting
   */
  async getItilMetrics(startDate: Date, endDate: Date): Promise<any> {
    try {
      const tickets = await this.knex('tickets')
        .select('*')
        .whereBetween('entered_at', [startDate, endDate]);

      const metrics = {
        totalIncidents: tickets.length,
        resolvedIncidents: tickets.filter(t => t.closed_at).length,
        slaBreaches: tickets.filter(t => t.sla_breach).length,
        escalatedIncidents: tickets.filter(t => t.escalated).length,
        averageResolutionTime: 0,
        byPriority: {} as Record<number, number>,
        byCategory: {} as Record<string, number>,
        firstCallResolutionRate: 0
      };

      // Calculate average resolution time
      const resolvedTickets = tickets.filter(t => t.closed_at && t.entered_at);
      if (resolvedTickets.length > 0) {
        const totalResolutionTime = resolvedTickets.reduce((sum, ticket) => {
          const entered = new Date(ticket.entered_at);
          const closed = new Date(ticket.closed_at);
          return sum + (closed.getTime() - entered.getTime());
        }, 0);
        
        metrics.averageResolutionTime = totalResolutionTime / resolvedTickets.length / (1000 * 60 * 60); // hours
      }

      // Group by priority
      tickets.forEach(ticket => {
        if (ticket.itil_impact && ticket.itil_urgency) {
          const priority = calculateItilPriority(ticket.itil_impact, ticket.itil_urgency);
          metrics.byPriority[priority] = (metrics.byPriority[priority] || 0) + 1;
        }
      });

      // Group by category (now using unified category system)
      tickets.forEach(ticket => {
        // NOTE: Categories are now in the unified category_id field
        // This should be updated to query the category name from standard_categories
        if (ticket.category_id) {
          // TODO: Join with standard_categories to get category name for metrics
          metrics.byCategory['Unified Categories'] = (metrics.byCategory['Unified Categories'] || 0) + 1;
        }
      });

      // Calculate first call resolution rate (simplified - tickets resolved without escalation)
      const firstCallResolved = tickets.filter(t => t.closed_at && !t.escalated).length;
      metrics.firstCallResolutionRate = tickets.length > 0 ? (firstCallResolved / tickets.length) * 100 : 0;

      return metrics;
    } catch (error) {
      console.error('Error getting ITIL metrics:', error);
      throw error;
    }
  }

  /**
   * Create problem record from incident
   */
  async createProblemFromIncident(incidentId: string, problemData: {
    title: string;
    description: string;
    rootCause?: string;
    workaround?: string;
  }): Promise<string> {
    try {
      // Note: This assumes a problems table exists
      // In a real implementation, you would need to create the problems table structure
      const problemId = await this.knex.transaction(async (trx) => {
        // Create problem record
        const [problem] = await trx('problems').insert({
          title: problemData.title,
          description: problemData.description,
          root_cause: problemData.rootCause,
          workaround: problemData.workaround,
          status: 'open',
          created_at: this.knex.fn.now()
        }).returning('problem_id');

        // Link incident to problem
        await trx('tickets')
          .where('ticket_id', incidentId)
          .update({
            related_problem_id: problem.problem_id,
            updated_at: this.knex.fn.now()
          });

        return problem.problem_id;
      });

      return problemId;
    } catch (error) {
      console.error('Error creating problem from incident:', error);
      throw error;
    }
  }

  /**
   * Map ITIL priority level to existing priority IDs
   * This would need to be adapted based on your actual priority records
   */
  private mapPriorityToId(priority: number): string {
    // This is a placeholder - you would need to map to actual priority IDs in your database
    const priorityMap: Record<number, string> = {
      1: 'critical-priority-id',
      2: 'high-priority-id', 
      3: 'medium-priority-id',
      4: 'low-priority-id',
      5: 'planning-priority-id'
    };
    
    return priorityMap[priority] || 'medium-priority-id';
  }
}

export default ItilService;