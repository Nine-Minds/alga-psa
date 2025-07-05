import { Context } from '@temporalio/activity';
import { getMainDatabase, getAdminDatabase, executeQuery, executeTransaction } from './connection.js';
import type {
  CreateAdminUserActivityInput,
  CreateAdminUserActivityResult
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

/**
 * Create an admin user for the tenant
 */
export async function createAdminUserInDB(
  input: CreateAdminUserActivityInput
): Promise<CreateAdminUserActivityResult> {
  const log = logger();
  log.info('Creating admin user in database', { 
    email: input.email, 
    tenantId: input.tenantId 
  });

  try {
    const adminDb = getAdminDatabase();
    
    const result = await executeTransaction(adminDb, async (client) => {
      // Check if user already exists
      const existingUser = await client.query(
        'SELECT user_id FROM users WHERE email = $1',
        [input.email]
      );

      if (existingUser.rows.length > 0) {
        throw new Error(`User with email ${input.email} already exists`);
      }

      // Generate temporary password
      const temporaryPassword = generateSecurePassword(12);
      
      // Create user (matching actual Alga schema)
      const userResult = await client.query(
        `INSERT INTO users (
          first_name, last_name, email, tenant, user_type, username, hashed_password
        ) VALUES ($1, $2, $3, $4, 'internal', $5, $6) 
        RETURNING user_id`,
        [
          input.firstName,
          input.lastName, 
          input.email,
          input.tenantId,
          input.email, // use email as username
          await hashPassword(temporaryPassword) // hash the temporary password
        ]
      );
      
      const userId = userResult.rows[0].user_id;

      // Find or create Admin role
      let adminRoleResult = await client.query(
        'SELECT role_id FROM roles WHERE role_name = $1 AND tenant = $2',
        ['Admin', input.tenantId]
      );

      let roleId: string;
      if (adminRoleResult.rows.length === 0) {
        // Create Admin role for this tenant
        const newRoleResult = await client.query(
          `INSERT INTO roles (role_name, tenant, description)
           VALUES ($1, $2, $3)
           RETURNING role_id`,
          ['Admin', input.tenantId, 'Administrator role with full access']
        );
        roleId = newRoleResult.rows[0].role_id;
        log.info('Created Admin role', { roleId, tenantId: input.tenantId });
      } else {
        roleId = adminRoleResult.rows[0].role_id;
      }

      // Associate user with tenant and role (using correct table name)
      await client.query(
        `INSERT INTO user_roles (user_id, tenant, role_id)
         VALUES ($1, $2, $3)`,
        [userId, input.tenantId, roleId]
      );

      // Note: Skipping company association for now - table structure unknown

      log.info('Admin user created successfully', { 
        userId, 
        tenantId: input.tenantId, 
        roleId 
      });

      return { userId, roleId, temporaryPassword };
    });

    return {
      userId: result.userId,
      roleId: result.roleId,
      temporaryPassword: result.temporaryPassword,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to create admin user', { error: errorMessage });
    throw new Error(`Failed to create admin user: ${errorMessage}`);
  }
}

/**
 * Rollback user creation (for error handling)
 */
export async function rollbackUserInDB(userId: string, tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back user creation', { userId, tenantId });

  try {
    const adminDb = getAdminDatabase();

    await executeTransaction(adminDb, async (client) => {
      // Delete user associations in reverse order
      await client.query(
        'DELETE FROM user_companies WHERE user_id = $1',
        [userId]
      );
      
      await client.query(
        'DELETE FROM user_tenant_roles WHERE user_id = $1 AND tenant_id = $2',
        [userId, tenantId]
      );
      
      await client.query(
        'DELETE FROM users WHERE user_id = $1',
        [userId]
      );
    });

    log.info('User rollback completed', { userId, tenantId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to rollback user', { error: errorMessage, userId, tenantId });
    // Don't throw here - rollback failures shouldn't mask the original error
  }
}

/**
 * Generate a secure temporary password
 */
function generateSecurePassword(length: number = 12): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  
  // Ensure at least one character from each category
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghijkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%^&*';
  
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill remaining length
  for (let i = 4; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Hash password (placeholder - in real implementation use bcrypt or similar)
 */
async function hashPassword(password: string): Promise<string> {
  // In a real implementation, use bcrypt or another secure hashing library
  // For now, return a placeholder hash
  return `hashed_${password}_${Date.now()}`;
}