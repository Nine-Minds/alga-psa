import { getCurrentTenantId } from '../db';
import { IProblem, IProblemListItem, IProblemIncident, IKnownError, IProblemAnalysis } from '../../interfaces/problem.interfaces';
import { Knex } from 'knex';

const Problem = {
  /**
   * Get all problems with optional filtering
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction, 
    filters?: {
      status?: string;
      priority?: string;
      assignedTo?: string;
      problemType?: 'proactive' | 'reactive';
      isKnownError?: boolean;
      searchQuery?: string;
    }
  ): Promise<IProblemListItem[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      let query = knexOrTrx('problems')
        .select(
          'problems.*',
          'problem_statuses.name as status_name',
          'priorities.priority_name',
          'priorities.color as priority_color',
          'categories.category_name',
          'created_user.first_name as created_by_first_name',
          'created_user.last_name as created_by_last_name',
          'assigned_user.first_name as assigned_to_first_name',
          'assigned_user.last_name as assigned_to_last_name',
          'manager_user.first_name as problem_manager_first_name',
          'manager_user.last_name as problem_manager_last_name'
        )
        .leftJoin('problem_statuses', 'problems.status_id', 'problem_statuses.status_id')
        .leftJoin('priorities', 'problems.priority_id', 'priorities.priority_id')
        .leftJoin('categories', 'problems.category_id', 'categories.category_id')
        .leftJoin('users as created_user', 'problems.created_by', 'created_user.user_id')
        .leftJoin('users as assigned_user', 'problems.assigned_to', 'assigned_user.user_id')
        .leftJoin('users as manager_user', 'problems.problem_manager', 'manager_user.user_id')
        .where('problems.tenant', tenant);

      // Apply filters
      if (filters?.status) {
        query = query.where('problems.status_id', filters.status);
      }
      if (filters?.priority) {
        query = query.where('problems.priority_id', filters.priority);
      }
      if (filters?.assignedTo) {
        query = query.where('problems.assigned_to', filters.assignedTo);
      }
      if (filters?.problemType) {
        query = query.where('problems.problem_type', filters.problemType);
      }
      if (filters?.isKnownError !== undefined) {
        query = query.where('problems.is_known_error', filters.isKnownError);
      }
      if (filters?.searchQuery) {
        query = query.where(function() {
          this.whereILike('problems.title', `%${filters.searchQuery}%`)
            .orWhereILike('problems.description', `%${filters.searchQuery}%`)
            .orWhereILike('problems.problem_number', `%${filters.searchQuery}%`);
        });
      }

      const problems = await query.orderBy('problems.created_at', 'desc');

      return problems.map(problem => ({
        ...problem,
        created_by_name: problem.created_by_first_name ? 
          `${problem.created_by_first_name} ${problem.created_by_last_name}` : '',
        assigned_to_name: problem.assigned_to_first_name ? 
          `${problem.assigned_to_first_name} ${problem.assigned_to_last_name}` : null,
        problem_manager_name: problem.problem_manager_first_name ? 
          `${problem.problem_manager_first_name} ${problem.problem_manager_last_name}` : null
      }));
    } catch (error) {
      console.error('Error getting all problems:', error);
      throw error;
    }
  },

  /**
   * Get a single problem by ID
   */
  get: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<IProblem | null> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const problem = await knexOrTrx('problems')
        .where({
          'problems.problem_id': id,
          'problems.tenant': tenant
        })
        .first();

      return problem || null;
    } catch (error) {
      console.error(`Error getting problem with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Create a new problem
   */
  create: async (knexOrTrx: Knex | Knex.Transaction, problemData: Partial<IProblem>): Promise<Pick<IProblem, "problem_id">> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      // Generate problem number
      const problemNumber = await generateProblemNumber(knexOrTrx, tenant);

      const problem = {
        ...problemData,
        tenant,
        problem_number: problemNumber,
        created_at: knexOrTrx.fn.now()
      };

      const [insertedProblem] = await knexOrTrx('problems')
        .insert(problem)
        .returning('problem_id');

      return { problem_id: insertedProblem.problem_id };
    } catch (error) {
      console.error('Error creating problem:', error);
      throw error;
    }
  },

  /**
   * Update a problem
   */
  update: async (knexOrTrx: Knex | Knex.Transaction, id: string, problemData: Partial<IProblem>): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await knexOrTrx('problems')
        .where({
          problem_id: id,
          tenant: tenant
        })
        .update({
          ...problemData,
          updated_at: knexOrTrx.fn.now()
        });
    } catch (error) {
      console.error(`Error updating problem with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Delete a problem
   */
  delete: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await knexOrTrx('problems')
        .where({
          problem_id: id,
          tenant: tenant
        })
        .del();
    } catch (error) {
      console.error(`Error deleting problem with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Link an incident to a problem
   */
  linkIncident: async (
    knexOrTrx: Knex | Knex.Transaction, 
    problemId: string, 
    incidentId: string, 
    relationshipType: 'caused_by' | 'related_to' | 'symptom_of' = 'caused_by',
    createdBy: string,
    notes?: string
  ): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      // Check if relationship already exists
      const existing = await knexOrTrx('problem_incidents')
        .where({
          problem_id: problemId,
          incident_id: incidentId,
          relationship_type: relationshipType
        })
        .first();

      if (existing) {
        return; // Relationship already exists
      }

      // Create the relationship
      await knexOrTrx('problem_incidents').insert({
        tenant,
        problem_id: problemId,
        incident_id: incidentId,
        relationship_type: relationshipType,
        created_by: createdBy,
        notes,
        created_at: knexOrTrx.fn.now()
      });

      // Update problem incident count
      await knexOrTrx('problems')
        .where('problem_id', problemId)
        .increment('incident_count', 1);

      // Update the incident's related_problem_id
      await knexOrTrx('tickets')
        .where('ticket_id', incidentId)
        .update({ related_problem_id: problemId });

    } catch (error) {
      console.error('Error linking incident to problem:', error);
      throw error;
    }
  },

  /**
   * Get incidents related to a problem
   */
  getRelatedIncidents: async (knexOrTrx: Knex | Knex.Transaction, problemId: string): Promise<any[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const incidents = await knexOrTrx('problem_incidents')
        .select(
          'problem_incidents.*',
          'tickets.ticket_number',
          'tickets.title',
          'tickets.status_id',
          'tickets.priority_id',
          'tickets.created_at as incident_created_at',
          'statuses.name as status_name'
        )
        .leftJoin('tickets', 'problem_incidents.incident_id', 'tickets.ticket_id')
        .leftJoin('statuses', 'tickets.status_id', 'statuses.status_id')
        .where({
          'problem_incidents.problem_id': problemId,
          'problem_incidents.tenant': tenant
        })
        .orderBy('problem_incidents.created_at', 'desc');

      return incidents;
    } catch (error) {
      console.error('Error getting related incidents:', error);
      throw error;
    }
  },

  /**
   * Convert problem to known error
   */
  convertToKnownError: async (
    knexOrTrx: Knex | Knex.Transaction,
    problemId: string,
    knownErrorData: Partial<IKnownError>
  ): Promise<string> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      return await knexOrTrx.transaction(async (trx) => {
        // Update problem as known error
        await trx('problems')
          .where('problem_id', problemId)
          .update({
            is_known_error: true,
            known_error_date: trx.fn.now(),
            updated_at: trx.fn.now()
          });

        // Generate error code if not provided
        const errorCode = knownErrorData.error_code || await generateErrorCode(trx, tenant);

        // Create known error record
        const [knownError] = await trx('known_errors')
          .insert({
            tenant,
            problem_id: problemId,
            error_code: errorCode,
            ...knownErrorData,
            identified_date: trx.fn.now(),
            created_at: trx.fn.now()
          })
          .returning('known_error_id');

        return knownError.known_error_id;
      });
    } catch (error) {
      console.error('Error converting problem to known error:', error);
      throw error;
    }
  }
};

/**
 * Generate a unique problem number
 */
async function generateProblemNumber(knex: Knex | Knex.Transaction, tenant: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PRB${year}`;
  
  const lastProblem = await knex('problems')
    .where('tenant', tenant)
    .where('problem_number', 'like', `${prefix}%`)
    .orderBy('problem_number', 'desc')
    .first();

  let sequence = 1;
  if (lastProblem) {
    const lastSequence = parseInt(lastProblem.problem_number.replace(prefix, ''), 10);
    sequence = lastSequence + 1;
  }

  return `${prefix}${sequence.toString().padStart(6, '0')}`;
}

/**
 * Generate a unique error code
 */
async function generateErrorCode(knex: Knex | Knex.Transaction, tenant: string): Promise<string> {
  const prefix = 'KE';
  
  const lastError = await knex('known_errors')
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

export default Problem;