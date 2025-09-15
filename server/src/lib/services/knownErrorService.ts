import { Knex } from 'knex';
import { IKnownError } from '../../interfaces/problem.interfaces';
import { getCurrentTenantId } from '../db';

/**
 * Known Error Database (KEDB) Service
 * Manages known errors for quick resolution of recurring incidents
 */
export class KnownErrorService {
  constructor(private knex: Knex) {}

  /**
   * Create a new known error entry
   */
  async createKnownError(knownErrorData: Partial<IKnownError>): Promise<string> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      // Generate error code if not provided
      const errorCode = knownErrorData.error_code || await this.generateErrorCode();

      const knownError = {
        tenant,
        error_code: errorCode,
        identified_date: new Date().toISOString(),
        occurrence_count: 1,
        ...knownErrorData,
        created_at: this.knex.fn.now()
      };

      const [result] = await this.knex('known_errors')
        .insert(knownError)
        .returning('known_error_id');

      return result.known_error_id;
    } catch (error) {
      console.error('Error creating known error:', error);
      throw error;
    }
  }

  /**
   * Get all known errors with filtering
   */
  async getKnownErrors(filters?: {
    errorType?: 'software' | 'hardware' | 'network' | 'process' | 'environmental';
    severity?: 'critical' | 'high' | 'medium' | 'low';
    resolved?: boolean;
    searchQuery?: string;
  }): Promise<IKnownError[]> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      let query = this.knex('known_errors')
        .select('known_errors.*', 'problems.problem_number', 'problems.title as problem_title')
        .leftJoin('problems', 'known_errors.problem_id', 'problems.problem_id')
        .where('known_errors.tenant', tenant);

      // Apply filters
      if (filters?.errorType) {
        query = query.where('known_errors.error_type', filters.errorType);
      }
      if (filters?.severity) {
        query = query.where('known_errors.severity', filters.severity);
      }
      if (filters?.resolved === true) {
        query = query.whereNotNull('known_errors.resolved_date');
      } else if (filters?.resolved === false) {
        query = query.whereNull('known_errors.resolved_date');
      }
      if (filters?.searchQuery) {
        query = query.where(function() {
          this.whereILike('known_errors.title', `%${filters.searchQuery}%`)
            .orWhereILike('known_errors.description', `%${filters.searchQuery}%`)
            .orWhereILike('known_errors.symptoms', `%${filters.searchQuery}%`)
            .orWhereILike('known_errors.error_code', `%${filters.searchQuery}%`);
        });
      }

      const results = await query.orderBy('known_errors.created_at', 'desc');
      return results;
    } catch (error) {
      console.error('Error getting known errors:', error);
      throw error;
    }
  }

  /**
   * Get a single known error by ID
   */
  async getKnownError(knownErrorId: string): Promise<IKnownError | null> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const knownError = await this.knex('known_errors')
        .where({
          known_error_id: knownErrorId,
          tenant
        })
        .first();

      return knownError || null;
    } catch (error) {
      console.error('Error getting known error:', error);
      throw error;
    }
  }

  /**
   * Update a known error
   */
  async updateKnownError(knownErrorId: string, updateData: Partial<IKnownError>): Promise<void> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await this.knex('known_errors')
        .where({
          known_error_id: knownErrorId,
          tenant
        })
        .update({
          ...updateData,
          updated_at: this.knex.fn.now()
        });
    } catch (error) {
      console.error('Error updating known error:', error);
      throw error;
    }
  }

  /**
   * Mark a known error as resolved
   */
  async resolveKnownError(knownErrorId: string, resolutionSteps?: string): Promise<void> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await this.knex('known_errors')
        .where({
          known_error_id: knownErrorId,
          tenant
        })
        .update({
          resolved_date: this.knex.fn.now(),
          resolution_steps: resolutionSteps,
          updated_at: this.knex.fn.now()
        });
    } catch (error) {
      console.error('Error resolving known error:', error);
      throw error;
    }
  }

  /**
   * Search for matching known errors based on incident symptoms
   */
  async searchBySymptoms(symptoms: string, limit: number = 10): Promise<any[]> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      // Extract keywords from symptoms
      const keywords = this.extractKeywords(symptoms);
      
      if (keywords.length === 0) {
        return [];
      }

      // Search for matches in symptoms, description, and title
      const results = await this.knex('known_errors')
        .select(
          'known_errors.*',
          'problems.problem_number',
          'problems.title as problem_title'
        )
        .leftJoin('problems', 'known_errors.problem_id', 'problems.problem_id')
        .where('known_errors.tenant', tenant)
        .whereNull('known_errors.resolved_date') // Only unresolved errors
        .where(function() {
          keywords.forEach((keyword, index) => {
            if (index === 0) {
              this.whereILike('known_errors.symptoms', `%${keyword}%`)
                .orWhereILike('known_errors.description', `%${keyword}%`)
                .orWhereILike('known_errors.title', `%${keyword}%`);
            } else {
              this.orWhereILike('known_errors.symptoms', `%${keyword}%`)
                .orWhereILike('known_errors.description', `%${keyword}%`)
                .orWhereILike('known_errors.title', `%${keyword}%`);
            }
          });
        })
        .orderBy('known_errors.occurrence_count', 'desc')
        .limit(limit);

      // Calculate match confidence for each result
      return results.map(result => ({
        ...result,
        match_confidence: this.calculateMatchConfidence(symptoms, result.symptoms + ' ' + result.description)
      })).sort((a, b) => b.match_confidence - a.match_confidence);

    } catch (error) {
      console.error('Error searching known errors by symptoms:', error);
      throw error;
    }
  }

  /**
   * Record an occurrence of a known error
   */
  async recordOccurrence(knownErrorId: string, incidentId?: string): Promise<void> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await this.knex('known_errors')
        .where({
          known_error_id: knownErrorId,
          tenant
        })
        .increment('occurrence_count', 1)
        .update({
          last_occurrence: this.knex.fn.now(),
          updated_at: this.knex.fn.now()
        });

      // If incident ID provided, link it to the problem
      if (incidentId) {
        const knownError = await this.getKnownError(knownErrorId);
        if (knownError?.problem_id) {
          // Link incident to the related problem
          await this.knex('problem_incidents').insert({
            tenant,
            problem_id: knownError.problem_id,
            incident_id: incidentId,
            relationship_type: 'caused_by',
            created_by: 'system', // System-generated link
            notes: `Automatically linked via known error: ${knownError.error_code}`,
            created_at: this.knex.fn.now()
          }).onConflict(['problem_id', 'incident_id', 'relationship_type']).ignore();
        }
      }
    } catch (error) {
      console.error('Error recording known error occurrence:', error);
      throw error;
    }
  }

  /**
   * Get known error statistics
   */
  async getStatistics(): Promise<any> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const stats = await this.knex('known_errors')
        .where('tenant', tenant)
        .select(
          this.knex.raw('COUNT(*) as total_known_errors'),
          this.knex.raw('COUNT(CASE WHEN resolved_date IS NULL THEN 1 END) as unresolved_errors'),
          this.knex.raw('COUNT(CASE WHEN resolved_date IS NOT NULL THEN 1 END) as resolved_errors'),
          this.knex.raw('SUM(occurrence_count) as total_occurrences'),
          this.knex.raw('AVG(occurrence_count) as avg_occurrences_per_error')
        )
        .first();

      // Get stats by error type
      const byType = await this.knex('known_errors')
        .where('tenant', tenant)
        .select('error_type')
        .count('* as count')
        .groupBy('error_type');

      // Get stats by severity
      const bySeverity = await this.knex('known_errors')
        .where('tenant', tenant)
        .select('severity')
        .count('* as count')
        .groupBy('severity');

      // Get most frequent errors
      const mostFrequent = await this.knex('known_errors')
        .where('tenant', tenant)
        .select('error_code', 'title', 'occurrence_count')
        .orderBy('occurrence_count', 'desc')
        .limit(10);

      return {
        ...stats,
        by_type: byType.reduce((acc, item) => {
          acc[item.error_type] = Number(item.count);
          return acc;
        }, {} as Record<string, number>),
        by_severity: bySeverity.reduce((acc, item) => {
          acc[item.severity] = Number(item.count);
          return acc;
        }, {} as Record<string, number>),
        most_frequent: mostFrequent
      };
    } catch (error) {
      console.error('Error getting known error statistics:', error);
      throw error;
    }
  }

  /**
   * Convert a problem to a known error
   */
  async convertProblemToKnownError(problemId: string, knownErrorData: Partial<IKnownError>): Promise<string> {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      return await this.knex.transaction(async (trx) => {
        // Verify problem exists
        const problem = await trx('problems')
          .where({ problem_id: problemId, tenant })
          .first();

        if (!problem) {
          throw new Error('Problem not found');
        }

        // Create known error
        const knownErrorId = await this.createKnownErrorInTransaction(trx, {
          problem_id: problemId,
          title: knownErrorData.title || problem.title,
          description: knownErrorData.description || problem.description,
          symptoms: knownErrorData.symptoms || problem.description,
          workaround: knownErrorData.workaround || problem.workaround,
          ...knownErrorData
        });

        // Update problem as known error
        await trx('problems')
          .where('problem_id', problemId)
          .update({
            is_known_error: true,
            known_error_date: trx.fn.now(),
            updated_at: trx.fn.now()
          });

        return knownErrorId;
      });
    } catch (error) {
      console.error('Error converting problem to known error:', error);
      throw error;
    }
  }

  /**
   * Generate a unique error code
   */
  private async generateErrorCode(): Promise<string> {
    const tenant = await getCurrentTenantId();
    const prefix = 'KE';
    
    const lastError = await this.knex('known_errors')
      .where('tenant', tenant)
      .where('error_code', 'like', `${prefix}%`)
      .orderBy('error_code', 'desc')
      .first();

    let sequence = 1;
    if (lastError) {
      const lastSequence = parseInt(lastError.error_code.replace(prefix, ''), 10);
      sequence = lastSequence + 1;
    }

    return `${prefix}${sequence.toString().padStart(4, '0')}`;
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

    return [...new Set(words)].slice(0, 15);
  }

  /**
   * Calculate match confidence between two texts
   */
  private calculateMatchConfidence(text1: string, text2: string): number {
    const words1 = new Set(this.extractKeywords(text1));
    const words2 = new Set(this.extractKeywords(text2));

    if (words1.size === 0 || words2.size === 0) {
      return 0;
    }

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size; // Jaccard similarity
  }

  /**
   * Create known error within a transaction
   */
  private async createKnownErrorInTransaction(
    trx: Knex.Transaction, 
    knownErrorData: Partial<IKnownError>
  ): Promise<string> {
    const tenant = await getCurrentTenantId();
    const errorCode = knownErrorData.error_code || await this.generateErrorCode();

    const knownError = {
      tenant,
      error_code: errorCode,
      identified_date: new Date().toISOString(),
      occurrence_count: 1,
      ...knownErrorData,
      created_at: trx.fn.now()
    };

    const [result] = await trx('known_errors')
      .insert(knownError)
      .returning('known_error_id');

    return result.known_error_id;
  }
}

export default KnownErrorService;