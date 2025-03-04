'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import { IUser } from 'server/src/interfaces/auth.interfaces';

/**
 * Update a client user
 */
export async function updateClientUser(
  userId: string,
  userData: Partial<IUser>
): Promise<IUser | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const [updatedUser] = await knex('users')
      .where({ user_id: userId, tenant })
      .update({
        ...userData,
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return updatedUser || null;
  } catch (error) {
    console.error('Error updating client user:', error);
    throw error;
  }
}

/**
 * Reset client user password
 */
export async function resetClientUserPassword(
  userId: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Check if the password field exists in the users table
    const hasPasswordField = await knex.schema.hasColumn('users', 'password');
    const passwordField = hasPasswordField ? 'password' : 'hashed_password';
    
    console.log(`Using password field: ${passwordField}`);
    
    const hashedPassword = await hashPassword(newPassword);
    
    const updateData: any = {
      updated_at: new Date().toISOString()
    };
    updateData[passwordField] = hashedPassword;
    
    await knex('users')
      .where({ user_id: userId, tenant })
      .update(updateData);

    return { success: true };
  } catch (error) {
    console.error('Error resetting client user password:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get client user by ID
 */
export async function getClientUserById(userId: string): Promise<IUser | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const user = await knex('users')
      .where({ user_id: userId, tenant, user_type: 'client' })
      .first();

    return user || null;
  } catch (error) {
    console.error('Error getting client user:', error);
    throw error;
  }
}

/**
 * Create a client user 
 */
export async function createClientUser({
  email,
  password,
  contactId,
  companyId
}: {
  email: string;
  password: string;
  contactId: string;
  companyId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get or create the appropriate client role
    const clientRole = await knex('roles')
      .where({ name: 'Client', tenant })
      .first();

    if (!clientRole) {
      throw new Error('Client role not found');
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Create the user
    const [user] = await knex('users')
      .insert({
        tenant,
        email,
        password: hashedPassword,
        contact_id: contactId,
        user_type: 'client',
        is_inactive: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');

    // Assign the client role
    await knex('user_roles')
      .insert({
        user_id: user.user_id,
        role_id: clientRole.role_id,
        tenant
      });

    return { success: true };
  } catch (error) {
    console.error('Error creating client user:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
