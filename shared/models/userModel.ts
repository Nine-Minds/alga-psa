/**
 * Shared User Model - Core business logic for user operations
 * This model contains the essential user business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { hashPassword } from '../utils/encryption';
import type {
  IUser,
  IRole,
  CreatePortalUserInput,
  CreatePortalUserResult,
  PortalRoleOptions
} from '../interfaces/user.interfaces';

// Re-export types for convenience
export type {
  CreatePortalUserInput,
  CreatePortalUserResult,
  PortalRoleOptions
};

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Portal user input validation schema
 */
export const portalUserInputSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  contactId: z.string().uuid('Contact ID must be a valid UUID'),
  clientId: z.string().uuid('Client ID must be a valid UUID'),
  tenantId: z.string().uuid('Tenant ID must be a valid UUID'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  roleId: z.string().uuid().optional(),
  isClientAdmin: z.boolean().optional()
});

// =============================================================================
// PORTAL USER OPERATIONS
// =============================================================================

/**
 * Determine the appropriate portal role for a user
 * @param trx - Knex transaction
 * @param options - Options for determining role
 * @returns The role to assign or null if not found
 */
export async function determinePortalUserRole(
  trx: Knex.Transaction,
  options: PortalRoleOptions
): Promise<IRole | null> {
  const { isClientAdmin, tenantId, roleId } = options;

  // If a specific roleId is provided, validate and use it
  if (roleId) {
    const role = await trx('roles')
      .where({
        role_id: roleId,
        tenant: tenantId,
        client: true
      })
      .first();

    if (!role) {
      throw new Error('Invalid role ID or role is not a client portal role');
    }

    return role;
  }

  // Determine role based on isClientAdmin flag
  const roleName = isClientAdmin ? 'admin' : 'user';

  // Get the appropriate client portal role
  let clientRole = await trx('roles')
    .where({
      tenant: tenantId,
      client: true,
      msp: false
    })
    .whereRaw('LOWER(role_name) = ?', [roleName])
    .first();

  if (!clientRole) {
    throw new Error(`Client portal ${roleName} role not found for tenant`);
  }

  return clientRole;
}

/**
 * Check if the password field exists in the users table
 * Some databases use 'password' while others use 'hashed_password'
 */
export async function getPasswordFieldName(knex: Knex): Promise<string> {
  const hasPasswordField = await knex.schema.hasColumn('users', 'password');
  return hasPasswordField ? 'password' : 'hashed_password';
}

/**
 * Create a portal user in the database
 * This is the core logic for creating client/portal users
 */
async function _createPortalUserInDBWithTrx(
  trx: Knex.Transaction,
  input: CreatePortalUserInput
): Promise<CreatePortalUserResult> {
  try {
      // Check if a client-portal user already exists for this email
      // Allow the same email to exist for other user types (e.g., internal MSP users)
      const existingUser = await trx('users')
        .where({
          email: input.email.toLowerCase(),
          tenant: input.tenantId,
          user_type: 'client'
        })
        .first();

      if (existingUser) {
        throw new Error('A client portal user with this email already exists');
      }

      // Get the contact to check is_client_admin flag if not explicitly provided
      let isClientAdmin = input.isClientAdmin;
      if (isClientAdmin === undefined) {
        const contact = await trx('contacts')
          .where({
            contact_name_id: input.contactId,
            tenant: input.tenantId
          })
          .first();

        if (!contact) {
          throw new Error('Contact not found');
        }

        isClientAdmin = contact.is_client_admin || false;
      }

      // Determine the role to assign
      const roleToAssign = await determinePortalUserRole(trx, {
        isClientAdmin: isClientAdmin || false,
        tenantId: input.tenantId,
        roleId: input.roleId
      });

      if (!roleToAssign) {
        throw new Error('Unable to determine appropriate portal role');
      }

      // Hash the password
      const hashedPassword = await hashPassword(input.password);

      // Create the user with dynamic password field
      const userData: any = {
        user_id: uuidv4(),
        tenant: input.tenantId,
        email: input.email.toLowerCase(),
        username: input.email.toLowerCase(),
        contact_id: input.contactId,
        user_type: 'client',
        is_inactive: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        hashed_password: hashedPassword
      };

      // Add optional fields
      if (input.firstName) userData.first_name = input.firstName;
      if (input.lastName) userData.last_name = input.lastName;

      // Insert the user
      const [user] = await trx('users')
        .insert(userData)
        .returning('*');

      // Assign the role
      await trx('user_roles')
        .insert({
          user_id: user.user_id,
          role_id: roleToAssign.role_id,
          tenant: input.tenantId
        });

      return {
        success: true,
        userId: user.user_id,
        roleId: roleToAssign.role_id
      };
  } catch (error) {
    console.error('Error creating portal user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Create a portal user using an existing transaction
 */
export async function createPortalUserInDBWithTrx(
  trx: Knex.Transaction,
  input: CreatePortalUserInput
): Promise<CreatePortalUserResult> {
  return _createPortalUserInDBWithTrx(trx, input);
}

/**
 * Create a portal user, managing its own transaction
 */
export async function createPortalUserInDB(
  knex: Knex,
  input: CreatePortalUserInput
): Promise<CreatePortalUserResult> {
  try {
    const result = await knex.transaction(async (trx: Knex.Transaction) => {
      return _createPortalUserInDBWithTrx(trx, input);
    });

    return result;
  } catch (error) {
    console.error('Error creating portal user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get portal users for a client
 */
export async function getPortalUsersForClient(
  knex: Knex,
  clientId: string,
  tenantId: string
): Promise<IUser[]> {
  try {
    // Get all contacts for the client
    const contacts = await knex('contacts')
      .where({
        client_id: clientId,
        tenant: tenantId
      })
      .select('contact_name_id');

    const contactIds = contacts.map(c => c.contact_name_id);

    if (contactIds.length === 0) {
      return [];
    }

    // Get all users associated with these contacts
    const users = await knex('users')
      .whereIn('contact_id', contactIds)
      .andWhere({
        tenant: tenantId,
        user_type: 'client'
      })
      .select('*');

    return users;
  } catch (error) {
    console.error('Error fetching portal users for client:', error);
    return [];
  }
}

/**
 * Get available client portal roles
 */
export async function getClientPortalRoles(
  knex: Knex,
  tenantId: string
): Promise<IRole[]> {
  try {
    const roles = await knex('roles')
      .where({
        tenant: tenantId,
        client: true,
        msp: false
      })
      .select('*');

    return roles;
  } catch (error) {
    console.error('Error fetching client portal roles:', error);
    return [];
  }
}

/**
 * Validate portal user input
 */
export function validatePortalUserInput(input: unknown): {
  valid: boolean;
  data?: CreatePortalUserInput;
  errors?: z.ZodError;
} {
  try {
    const validated = portalUserInputSchema.parse(input) as CreatePortalUserInput;
    return {
      valid: true,
      data: validated
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        errors: error
      };
    }
    throw error;
  }
}
