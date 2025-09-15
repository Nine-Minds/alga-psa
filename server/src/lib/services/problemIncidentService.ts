import { Knex } from 'knex';
import { IProblemIncident } from '../../interfaces/problem.interfaces';
import { ITicket } from '../../interfaces/ticket.interfaces';
import { getCurrentTenantId } from '../db';

/**
 * Service for managing Problem-Incident relationships
 * Implements ITIL best practices for linking incidents to problems
 */
export class ProblemIncidentService {
  constructor(private knex: Knex) {}

  /**
   * Link an incident to a problem
   */
  async linkIncidentToProblem(
    problemId: string,
    incidentId: string,
    relationshipType: 'caused_by' | 'related_to' | 'symptom_of' = 'caused_by',
    createdBy: string,
    notes?: string
  ): Promise<void> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      await this.knex.transaction(async (trx) => {
        // Check if relationship already exists
        const existing = await trx('problem_incidents')
          .where({
            problem_id: problemId,
            incident_id: incidentId,
            relationship_type: relationshipType
          })
          .first();

        if (existing) {
          throw new Error('Relationship already exists between this problem and incident');
        }

        // Verify problem exists
        const problem = await trx('problems')
          .where('problem_id', problemId)
          .where('tenant', tenant)
          .first();

        if (!problem) {
          throw new Error('Problem not found');
        }

        // Verify incident exists
        const incident = await trx('tickets')
          .where('ticket_id', incidentId)
          .where('tenant', tenant)
          .first();

        if (!incident) {
          throw new Error('Incident not found');
        }

        // Create the relationship
        await trx('problem_incidents').insert({
          tenant,
          problem_id: problemId,
          incident_id: incidentId,
          relationship_type: relationshipType,
          created_by: createdBy,
          notes,
          created_at: trx.fn.now()
        });

        // Update problem incident count
        await trx('problems')
          .where('problem_id', problemId)
          .increment('incident_count', 1)
          .update({ updated_at: trx.fn.now() });

        // Update the incident's related_problem_id field
        await trx('tickets')
          .where('ticket_id', incidentId)
          .update({ 
            related_problem_id: problemId,
            updated_at: trx.fn.now()
          });

        // Update problem's last occurrence if incident is newer
        const problemLastOccurrence = problem.last_occurrence ? new Date(problem.last_occurrence) : null;
        const incidentDate = new Date(incident.entered_at);

        if (!problemLastOccurrence || incidentDate > problemLastOccurrence) {
          await trx('problems')
            .where('problem_id', problemId)
            .update({ 
              last_occurrence: incident.entered_at,
              updated_at: trx.fn.now()
            });
        }
      });
    } catch (error) {
      console.error('Error linking incident to problem:', error);
      throw error;
    }
  }

  /**
   * Remove link between incident and problem
   */
  async unlinkIncidentFromProblem(
    problemId: string,
    incidentId: string,
    relationshipType?: 'caused_by' | 'related_to' | 'symptom_of'
  ): Promise<void> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      await this.knex.transaction(async (trx) => {
        const whereClause: any = {
          problem_id: problemId,
          incident_id: incidentId,
          tenant
        };

        if (relationshipType) {
          whereClause.relationship_type = relationshipType;
        }

        // Remove the relationship(s)
        const deletedCount = await trx('problem_incidents')
          .where(whereClause)
          .del();

        if (deletedCount > 0) {
          // Update problem incident count
          await trx('problems')
            .where('problem_id', problemId)
            .decrement('incident_count', deletedCount)
            .update({ updated_at: trx.fn.now() });

          // Check if this was the only relationship for this incident
          const remainingRelationships = await trx('problem_incidents')
            .where('incident_id', incidentId)
            .count('* as count')
            .first();

          // If no more relationships exist, remove the related_problem_id from the incident
          if (remainingRelationships && Number(remainingRelationships.count) === 0) {
            await trx('tickets')
              .where('ticket_id', incidentId)
              .update({ 
                related_problem_id: null,
                updated_at: trx.fn.now()
              });
          }
        }
      });
    } catch (error) {
      console.error('Error unlinking incident from problem:', error);
      throw error;
    }
  }

  /**
   * Get all incidents related to a problem
   */
  async getIncidentsForProblem(problemId: string): Promise<any[]> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const incidents = await this.knex('problem_incidents')
        .select(
          'problem_incidents.relationship_type',
          'problem_incidents.created_at as linked_at',
          'problem_incidents.notes as link_notes',
          'tickets.ticket_id',
          'tickets.ticket_number',
          'tickets.title',
          'tickets.entered_at',
          'tickets.closed_at',
          'tickets.priority_id',
          'tickets.status_id',
          'tickets.assigned_to',
          'statuses.name as status_name',
          'priorities.priority_name',
          'priorities.color as priority_color',
          'users.first_name as assigned_first_name',
          'users.last_name as assigned_last_name'
        )
        .leftJoin('tickets', 'problem_incidents.incident_id', 'tickets.ticket_id')
        .leftJoin('statuses', 'tickets.status_id', 'statuses.status_id')
        .leftJoin('priorities', 'tickets.priority_id', 'priorities.priority_id')
        .leftJoin('users', 'tickets.assigned_to', 'users.user_id')
        .where({
          'problem_incidents.problem_id': problemId,
          'problem_incidents.tenant': tenant
        })
        .orderBy('problem_incidents.created_at', 'desc');

      return incidents.map(incident => ({
        ...incident,
        assigned_to_name: incident.assigned_first_name ? 
          `${incident.assigned_first_name} ${incident.assigned_last_name}` : null
      }));
    } catch (error) {
      console.error('Error getting incidents for problem:', error);
      throw error;
    }
  }

  /**
   * Get problems related to an incident
   */
  async getProblemsForIncident(incidentId: string): Promise<any[]> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const problems = await this.knex('problem_incidents')
        .select(
          'problem_incidents.relationship_type',
          'problem_incidents.created_at as linked_at',
          'problem_incidents.notes as link_notes',
          'problems.problem_id',
          'problems.problem_number',
          'problems.title',
          'problems.status_id',
          'problems.priority_id',
          'problems.problem_type',
          'problems.is_known_error',
          'problems.assigned_to',
          'problem_statuses.name as status_name',
          'priorities.priority_name',
          'priorities.color as priority_color',
          'users.first_name as assigned_first_name',
          'users.last_name as assigned_last_name'
        )
        .leftJoin('problems', 'problem_incidents.problem_id', 'problems.problem_id')
        .leftJoin('problem_statuses', 'problems.status_id', 'problem_statuses.status_id')
        .leftJoin('priorities', 'problems.priority_id', 'priorities.priority_id')
        .leftJoin('users', 'problems.assigned_to', 'users.user_id')
        .where({
          'problem_incidents.incident_id': incidentId,
          'problem_incidents.tenant': tenant
        })
        .orderBy('problem_incidents.created_at', 'desc');

      return problems.map(problem => ({
        ...problem,
        assigned_to_name: problem.assigned_first_name ? 
          `${problem.assigned_first_name} ${problem.assigned_last_name}` : null
      }));
    } catch (error) {
      console.error('Error getting problems for incident:', error);
      throw error;
    }
  }

  /**
   * Auto-detect potential problem-incident relationships
   * Based on similar symptoms, categories, or keywords
   */
  async detectPotentialRelationships(incidentId: string): Promise<any[]> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      // Get the incident details
      const incident = await this.knex('tickets')
        .where('ticket_id', incidentId)
        .where('tenant', tenant)
        .first();

      if (!incident) {
        throw new Error('Incident not found');
      }

      const potentialProblems = [];

      // 1. Find problems with same ITIL category
      if (incident.itil_category) {
        const categoryProblems = await this.knex('problems')
          .select('problem_id', 'problem_number', 'title', 'is_known_error', 'incident_count')
          .where('tenant', tenant)
          .where('category_id', incident.category_id)
          .whereNotIn('status_id', function() {
            this.select('status_id').from('problem_statuses').where('is_closed', true);
          })
          .limit(5);

        potentialProblems.push(...categoryProblems.map((p: any) => ({
          ...p,
          match_reason: 'Same category',
          confidence: 0.7
        })));
      }

      // 2. Find problems with similar keywords in title/description
      const keywords = this.extractKeywords(incident.title + ' ' + (incident.description || ''));
      
      if (keywords.length > 0) {
        const keywordQuery = keywords.map(keyword => `%${keyword}%`);
        
        const keywordProblems = await this.knex('problems')
          .select('problem_id', 'problem_number', 'title', 'is_known_error', 'incident_count')
          .where('tenant', tenant)
          .where(function() {
            keywords.forEach((keyword, index) => {
              if (index === 0) {
                this.whereILike('title', `%${keyword}%`)
                  .orWhereILike('description', `%${keyword}%`);
              } else {
                this.orWhereILike('title', `%${keyword}%`)
                  .orWhereILike('description', `%${keyword}%`);
              }
            });
          })
          .whereNotIn('status_id', function() {
            this.select('status_id').from('problem_statuses').where('is_closed', true);
          })
          .limit(5);

        potentialProblems.push(...keywordProblems.map((p: any) => ({
          ...p,
          match_reason: 'Similar keywords',
          confidence: 0.6
        })));
      }

      // 3. Find known errors that might be related
      const knownErrors = await this.knex('known_errors')
        .select(
          'known_errors.known_error_id',
          'known_errors.error_code',
          'known_errors.title',
          'known_errors.symptoms',
          'problems.problem_id',
          'problems.problem_number'
        )
        .leftJoin('problems', 'known_errors.problem_id', 'problems.problem_id')
        .where('known_errors.tenant', tenant)
        .whereNull('known_errors.resolved_date');

      for (const ke of knownErrors) {
        const symptomMatch = this.checkSymptomMatch(
          incident.title + ' ' + (incident.description || ''),
          ke.symptoms
        );
        
        if (symptomMatch > 0.5 && ke.problem_id) {
          potentialProblems.push({
            problem_id: ke.problem_id,
            problem_number: ke.problem_number,
            title: ke.title,
            is_known_error: true,
            match_reason: 'Known error symptom match',
            confidence: symptomMatch
          });
        }
      }

      // Remove duplicates and sort by confidence
      const uniqueProblems = potentialProblems.reduce((acc: any[], current: any) => {
        const existing = acc.find((p: any) => p.problem_id === current.problem_id);
        if (!existing || current.confidence > existing.confidence) {
          return [...acc.filter((p: any) => p.problem_id !== current.problem_id), current];
        }
        return acc;
      }, [] as any[]);

      return uniqueProblems
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10); // Return top 10 matches

    } catch (error) {
      console.error('Error detecting potential relationships:', error);
      throw error;
    }
  }

  /**
   * Get relationship statistics
   */
  async getRelationshipStats(problemId?: string): Promise<any> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      let query = this.knex('problem_incidents').where('tenant', tenant);
      
      if (problemId) {
        query = query.where('problem_id', problemId);
      }

      const stats = await query
        .select('relationship_type')
        .count('* as count')
        .groupBy('relationship_type');

      const totalRelationships = stats.reduce((sum, stat) => sum + Number(stat.count), 0);

      return {
        total_relationships: totalRelationships,
        by_type: stats.reduce((acc, stat) => {
          acc[stat.relationship_type] = Number(stat.count);
          return acc;
        }, {} as Record<string, number>)
      };

    } catch (error) {
      console.error('Error getting relationship stats:', error);
      throw error;
    }
  }

  /**
   * Extract keywords from text for matching
   */
  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['this', 'that', 'with', 'from', 'have', 'been', 'will', 'they', 'were', 'said'].includes(word));

    // Return unique words
    return [...new Set(words)].slice(0, 10);
  }

  /**
   * Check symptom match between incident and known error
   */
  private checkSymptomMatch(incidentText: string, symptoms: string): number {
    const incidentWords = new Set(this.extractKeywords(incidentText));
    const symptomWords = new Set(this.extractKeywords(symptoms));

    if (incidentWords.size === 0 || symptomWords.size === 0) {
      return 0;
    }

    const intersection = new Set([...incidentWords].filter(x => symptomWords.has(x)));
    const union = new Set([...incidentWords, ...symptomWords]);

    return intersection.size / union.size; // Jaccard similarity
  }
}

export default ProblemIncidentService;