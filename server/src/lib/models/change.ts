import { getCurrentTenantId } from '../db';
import { IChangeRequest, IChangeListItem, ICAB, ICABMeeting, ICABDecision } from '../../interfaces/change.interfaces';
import { Knex } from 'knex';

const Change = {
  /**
   * Get all change requests with optional filtering
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction, 
    filters?: {
      status?: string;
      changeType?: string;
      changeCategory?: string;
      riskLevel?: string;
      requestedBy?: string;
      changeOwner?: string;
      cabRequired?: boolean;
      searchQuery?: string;
    }
  ): Promise<IChangeListItem[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      let query = knexOrTrx('change_requests')
        .select(
          'change_requests.*',
          'change_statuses.name as status_name',
          'priorities.priority_name',
          'priorities.color as priority_color',
          'requested_user.first_name as requested_by_first_name',
          'requested_user.last_name as requested_by_last_name',
          'owner_user.first_name as change_owner_first_name',
          'owner_user.last_name as change_owner_last_name',
          'manager_user.first_name as change_manager_first_name',
          'manager_user.last_name as change_manager_last_name',
          'implementer_user.first_name as implementer_first_name',
          'implementer_user.last_name as implementer_last_name'
        )
        .leftJoin('change_statuses', 'change_requests.status_id', 'change_statuses.status_id')
        .leftJoin('priorities', 'change_requests.priority_id', 'priorities.priority_id')
        .leftJoin('users as requested_user', 'change_requests.requested_by', 'requested_user.user_id')
        .leftJoin('users as owner_user', 'change_requests.change_owner', 'owner_user.user_id')
        .leftJoin('users as manager_user', 'change_requests.change_manager', 'manager_user.user_id')
        .leftJoin('users as implementer_user', 'change_requests.implementer', 'implementer_user.user_id')
        .where('change_requests.tenant', tenant);

      // Apply filters
      if (filters?.status) {
        query = query.where('change_requests.status_id', filters.status);
      }
      if (filters?.changeType) {
        query = query.where('change_requests.change_type', filters.changeType);
      }
      if (filters?.changeCategory) {
        query = query.where('change_requests.change_category', filters.changeCategory);
      }
      if (filters?.riskLevel) {
        query = query.where('change_requests.risk_level', filters.riskLevel);
      }
      if (filters?.requestedBy) {
        query = query.where('change_requests.requested_by', filters.requestedBy);
      }
      if (filters?.changeOwner) {
        query = query.where('change_requests.change_owner', filters.changeOwner);
      }
      if (filters?.cabRequired !== undefined) {
        query = query.where('change_requests.cab_required', filters.cabRequired);
      }
      if (filters?.searchQuery) {
        query = query.where(function() {
          this.whereILike('change_requests.title', `%${filters.searchQuery}%`)
            .orWhereILike('change_requests.description', `%${filters.searchQuery}%`)
            .orWhereILike('change_requests.change_number', `%${filters.searchQuery}%`);
        });
      }

      const changes = await query.orderBy('change_requests.created_at', 'desc');

      return changes.map(change => ({
        ...change,
        requested_by_name: change.requested_by_first_name ? 
          `${change.requested_by_first_name} ${change.requested_by_last_name}` : '',
        change_owner_name: change.change_owner_first_name ? 
          `${change.change_owner_first_name} ${change.change_owner_last_name}` : null,
        change_manager_name: change.change_manager_first_name ? 
          `${change.change_manager_first_name} ${change.change_manager_last_name}` : null,
        implementer_name: change.implementer_first_name ? 
          `${change.implementer_first_name} ${change.implementer_last_name}` : null
      }));
    } catch (error) {
      console.error('Error getting all change requests:', error);
      throw error;
    }
  },

  /**
   * Get a single change request by ID
   */
  get: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<IChangeRequest | null> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const change = await knexOrTrx('change_requests')
        .where({
          'change_requests.change_id': id,
          'change_requests.tenant': tenant
        })
        .first();

      return change || null;
    } catch (error) {
      console.error(`Error getting change request with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Create a new change request
   */
  create: async (knexOrTrx: Knex | Knex.Transaction, changeData: Partial<IChangeRequest>): Promise<Pick<IChangeRequest, "change_id">> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      // Generate change number
      const changeNumber = await generateChangeNumber(knexOrTrx, tenant, changeData.change_type || 'normal');

      // Determine if CAB approval is required
      const cabRequired = await determineCabRequirement(knexOrTrx, changeData);

      const change = {
        ...changeData,
        tenant,
        change_number: changeNumber,
        cab_required: cabRequired,
        created_at: knexOrTrx.fn.now()
      };

      const [insertedChange] = await knexOrTrx('change_requests')
        .insert(change)
        .returning('change_id');

      return { change_id: insertedChange.change_id };
    } catch (error) {
      console.error('Error creating change request:', error);
      throw error;
    }
  },

  /**
   * Update a change request
   */
  update: async (knexOrTrx: Knex | Knex.Transaction, id: string, changeData: Partial<IChangeRequest>): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await knexOrTrx('change_requests')
        .where({
          change_id: id,
          tenant: tenant
        })
        .update({
          ...changeData,
          updated_at: knexOrTrx.fn.now()
        });
    } catch (error) {
      console.error(`Error updating change request with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Delete a change request
   */
  delete: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await knexOrTrx('change_requests')
        .where({
          change_id: id,
          tenant: tenant
        })
        .del();
    } catch (error) {
      console.error(`Error deleting change request with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Submit change request for approval
   */
  submit: async (knexOrTrx: Knex | Knex.Transaction, changeId: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await knexOrTrx('change_requests')
        .where({ change_id: changeId, tenant })
        .update({
          status_id: 'submitted',
          submitted_at: knexOrTrx.fn.now(),
          updated_at: knexOrTrx.fn.now()
        });
    } catch (error) {
      console.error('Error submitting change request:', error);
      throw error;
    }
  },

  /**
   * Approve a change request
   */
  approve: async (
    knexOrTrx: Knex | Knex.Transaction, 
    changeId: string, 
    approvedBy: string, 
    notes?: string
  ): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await knexOrTrx('change_requests')
        .where({ change_id: changeId, tenant })
        .update({
          status_id: 'approved',
          approved_by: approvedBy,
          approved_at: knexOrTrx.fn.now(),
          approval_notes: notes,
          updated_at: knexOrTrx.fn.now()
        });
    } catch (error) {
      console.error('Error approving change request:', error);
      throw error;
    }
  },

  /**
   * Reject a change request
   */
  reject: async (
    knexOrTrx: Knex | Knex.Transaction, 
    changeId: string, 
    rejectedBy: string, 
    reason: string
  ): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      await knexOrTrx('change_requests')
        .where({ change_id: changeId, tenant })
        .update({
          status_id: 'rejected',
          rejected_by: rejectedBy,
          rejected_at: knexOrTrx.fn.now(),
          approval_notes: reason,
          updated_at: knexOrTrx.fn.now()
        });
    } catch (error) {
      console.error('Error rejecting change request:', error);
      throw error;
    }
  },

  /**
   * Get change requests requiring CAB approval
   */
  getPendingCabApproval: async (knexOrTrx: Knex | Knex.Transaction): Promise<IChangeRequest[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const changes = await knexOrTrx('change_requests')
        .where({
          tenant,
          cab_required: true
        })
        .whereIn('status_id', ['submitted', 'under_review', 'awaiting_cab'])
        .orderBy('created_at', 'asc');

      return changes;
    } catch (error) {
      console.error('Error getting pending CAB changes:', error);
      throw error;
    }
  },

  /**
   * Get changes scheduled for a date range
   */
  getScheduledChanges: async (
    knexOrTrx: Knex | Knex.Transaction, 
    startDate: string, 
    endDate: string
  ): Promise<IChangeRequest[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const changes = await knexOrTrx('change_requests')
        .where('tenant', tenant)
        .where(function() {
          this.whereBetween('scheduled_start_date', [startDate, endDate])
            .orWhereBetween('scheduled_end_date', [startDate, endDate])
            .orWhere(function() {
              this.where('scheduled_start_date', '<=', startDate)
                .andWhere('scheduled_end_date', '>=', endDate);
            });
        })
        .whereIn('status_id', ['approved', 'scheduled', 'in_progress'])
        .orderBy('scheduled_start_date', 'asc');

      return changes;
    } catch (error) {
      console.error('Error getting scheduled changes:', error);
      throw error;
    }
  }
};

/**
 * Generate a unique change number based on type and year
 */
async function generateChangeNumber(
  knex: Knex | Knex.Transaction, 
  tenant: string, 
  changeType: string
): Promise<string> {
  const year = new Date().getFullYear();
  const typePrefix = {
    'standard': 'STD',
    'normal': 'CHG',
    'emergency': 'EMG'
  };
  
  const prefix = `${typePrefix[changeType] || 'CHG'}${year}`;
  
  const lastChange = await knex('change_requests')
    .where('tenant', tenant)
    .where('change_number', 'like', `${prefix}%`)
    .orderBy('change_number', 'desc')
    .first();

  let sequence = 1;
  if (lastChange) {
    const lastSequence = parseInt(lastChange.change_number.replace(prefix, ''), 10);
    sequence = lastSequence + 1;
  }

  return `${prefix}${sequence.toString().padStart(6, '0')}`;
}

/**
 * Determine if CAB approval is required
 */
async function determineCabRequirement(
  knex: Knex | Knex.Transaction, 
  changeData: Partial<IChangeRequest>
): Promise<boolean> {
  // Emergency changes typically bypass CAB for speed
  if (changeData.emergency_change) {
    return false;
  }
  
  // Standard changes are pre-approved
  if (changeData.change_type === 'standard' && changeData.pre_approved) {
    return false;
  }
  
  // High risk changes always require CAB
  if (changeData.risk_level === 'high' || changeData.risk_level === 'very_high') {
    return true;
  }
  
  // Normal changes typically require CAB unless low risk
  if (changeData.change_type === 'normal') {
    return changeData.risk_level !== 'very_low' && changeData.risk_level !== 'low';
  }
  
  return false;
}

export default Change;