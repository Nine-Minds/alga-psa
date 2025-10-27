'use server';

import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { createTenantKnex } from '@server/lib/db';
import { getTenantForCurrentRequest } from '@server/lib/tenant';
import { revalidatePath } from 'next/cache';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { hashPassword } from '@server/utils/encryption/encryption';
import { createClient as createClientInternal } from '@product/actions/client-actions/clientActions';
import { createClientContact } from '@product/actions/contact-actions/contactActions';
import { updateTenantOnboardingStatus, saveTenantOnboardingProgress } from '@product/actions/tenant-settings-actions/tenantSettingsActions';
import { hasPermission } from '@server/lib/auth/rbac';

export interface OnboardingActionResult {
  success: boolean;
  error?: string;
  data?: any;
}

export interface ClientInfoData {
  firstName: string;
  lastName: string;
  clientName: string;
  email: string;
  newPassword?: string;
}

export interface TeamMember {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  password?: string;
}

export interface ClientData {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientUrl: string;
  clientId?: string; // Optional, for updates
}

export interface ClientContactData {
  contactName: string;
  contactEmail: string;
  contactRole: string;
  clientId: string;
}

export interface BillingData {
  serviceName: string;
  serviceDescription: string;
  servicePrice: string;
  contractLineName: string;
  serviceTypeId?: string;
}

export interface TicketingData {
  boardName: string;
  supportEmail: string;
  categories: (string | {
    category_id: string;
    category_name: string;
    display_order?: number;
    parent_category?: string | null;
  })[];
  priorities: (string | {
    priority_id: string;
    priority_name: string;
    color?: string;
    order_number?: number;
  })[];
  ticketPrefix?: string;
  ticketPaddingLength?: number;
  ticketStartNumber?: number;
  boardId?: string;
  isDefaultBoard?: boolean;
  statuses?: any[];
}

export async function saveClientInfo(data: ClientInfoData): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Only update user info if data is provided (for first-time users)
      // For returning users, these fields won't be in the data
      if (data.firstName || data.lastName || data.email) {
        const updateData: any = {
          updated_at: new Date()
        };

        if (data.firstName) updateData.first_name = data.firstName;
        if (data.lastName) updateData.last_name = data.lastName;
        if (data.email) updateData.email = data.email.toLowerCase();

        // If new password is provided, hash and update it
        if (data.newPassword) {
          updateData.hashed_password = await hashPassword(data.newPassword);
        }

        await trx('users')
          .where({ user_id: currentUser.user_id, tenant })
          .update(updateData);

        // If password was changed, mark it as reset
        if (data.newPassword) {
          const UserPreferences = await import('@server/lib/models/userPreferences').then(m => m.default);
          await UserPreferences.upsert(trx, {
            user_id: currentUser.user_id,
            setting_name: 'has_reset_password',
            setting_value: true,
            updated_at: new Date()
          });
        }
      }

      // Save progress to tenant settings
      const progressData: any = {
        clientName: data.clientName
      };

      if (data.firstName) progressData.firstName = data.firstName;
      if (data.lastName) progressData.lastName = data.lastName;
      if (data.email) progressData.email = data.email;

      await saveTenantOnboardingProgress(progressData);
    });

    revalidatePath('/msp/onboarding');
    return { success: true };
  } catch (error) {
    console.error('Error saving client info:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function addSingleTeamMember(member: TeamMember): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }
    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    // Check license limits for MSP (internal) users
    const { getLicenseUsage } = await import('@server/lib/license/get-license-usage');
    const usage = await getLicenseUsage(tenant);
    
    if (usage.limit !== null && usage.used >= usage.limit) {
      return { 
        success: false, 
        error: `You've reached your internal user licence limit of ${usage.limit}. Please remove or deactivate existing users to add new ones.`
      };
    }

    const { knex } = await createTenantKnex();
    let created: string | null = null;
    let alreadyExists = false;
    let error: string | null = null;

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      try {
        // Check if user already exists
        const existingUser = await trx('users')
          .where({ email: member.email.toLowerCase(), tenant })
          .first();

        if (existingUser) {
          alreadyExists = true;
          error = `User with email ${member.email} already exists`;
          return;
        }

        // Create new user (same logic as addTeamMembers)
        const userId = require('crypto').randomUUID();
        // Use provided password or generate a default one
        const tempPassword = await hashPassword(member.password || 'TempPassword123!');

        await trx('users').insert({
          user_id: userId,
          tenant,
          username: member.email.toLowerCase(),  // Use email as username
          first_name: member.firstName,
          last_name: member.lastName,
          email: member.email.toLowerCase(),
          hashed_password: tempPassword,
          is_inactive: false,
          user_type: 'internal',  // Internal user type for team members
          created_at: new Date(),
          updated_at: new Date()
        });

        // Get role from roles table by role_name
        const role = await trx('roles')
          .where({ 
            role_name: member.role.toLowerCase(), // Convert to lowercase to match DB convention
            tenant 
          })
          .first();

        if (role) {
          await trx('user_roles').insert({
            user_id: userId,
            role_id: role.role_id,
            tenant
          });
        } else {
          console.warn(`Role not found: ${member.role.toLowerCase()} for tenant ${tenant}`);
          // Try to assign a default role
          const defaultRole = await trx('roles')
            .where({ tenant, msp: true })
            .orderBy('role_name')
            .first();
          
          if (defaultRole) {
            await trx('user_roles').insert({
              user_id: userId,
              role_id: defaultRole.role_id,
              tenant
            });
          }
        }

        // Mark that the user hasn't reset their initial password
        const UserPreferences = await import('@server/lib/models/userPreferences').then(m => m.default);
        await UserPreferences.upsert(trx, {
          user_id: userId,
          setting_name: 'has_reset_password',
          setting_value: false,
          updated_at: new Date()
        });

        created = member.email;
      } catch (memberError) {
        error = memberError instanceof Error ? memberError.message : 'Unknown error';
      }
    });

    revalidatePath('/msp/onboarding');
    
    if (created) {
      return { 
        success: true, 
        data: { 
          created: created,
          licenseStatus: { current: usage.used + 1, limit: usage.limit }
        }
      };
    } else if (alreadyExists) {
      return { 
        success: false, 
        error: error || `User with email ${member.email} already exists`
      };
    } else {
      return { 
        success: false, 
        error: error || 'Failed to create team member'
      };
    }
  } catch (error) {
    console.error('Error adding single team member:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function addTeamMembers(members: TeamMember[]): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    // Check license limits for  MSP (internal) users
    const { knex } = await createTenantKnex();
    const { getLicenseUsage } = await import('@server/lib/license/get-license-usage');
    const usage = await getLicenseUsage(tenant);
    
    // Determine how many users we can actually add
    let membersToProcess = [...members];
    let skippedDueToLimit: string[] = [];
    
    if (usage.limit !== null) {
      const canAdd = Math.max(0, usage.limit - usage.used);
      
      if (canAdd === 0) {
        return { 
          success: false, 
          error: `You've reached your internal user licence limit of ${usage.limit}. Please remove or deactivate existing users to add new ones.`
        };
      }
      
      if (members.length > canAdd) {
        // Only process users up to the limit
        membersToProcess = members.slice(0, canAdd);
        const skippedMembers = members.slice(canAdd);
        skippedDueToLimit = skippedMembers.map(m => m.email);
        
        console.warn(`License limit allows only ${canAdd} more users. Skipping ${skippedMembers.length} users: ${skippedDueToLimit.join(', ')}`);
      }
    }

    const created: string[] = [];
    const alreadyExists: string[] = [];
    const failed: Array<{ member: TeamMember; error: string }> = [];

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      for (const member of membersToProcess) {
        try {
          // Check if user already exists
          const existingUser = await trx('users')
            .where({ email: member.email.toLowerCase(), tenant })
            .first();

          if (existingUser) {
            alreadyExists.push(member.email);
            continue;
          }

          // Create new user
          const userId = require('crypto').randomUUID();
          // Use provided password or generate a default one
          const tempPassword = await hashPassword(member.password || 'TempPassword123!');

          await trx('users').insert({
            user_id: userId,
            tenant,
            username: member.email.toLowerCase(),  // Use email as username
            first_name: member.firstName,
            last_name: member.lastName,
            email: member.email.toLowerCase(),
            hashed_password: tempPassword,  // Changed from password_hash
            is_inactive: false,
            user_type: 'internal',  // Added to ensure internal user type
            created_at: new Date(),
            updated_at: new Date()
          });

          // Get role from roles table by role_name
          const role = await trx('roles')
            .where({ 
              role_name: member.role.toLowerCase(), // Convert to lowercase to match DB convention
              tenant 
            })
            .first();

          if (role) {
            await trx('user_roles').insert({
              user_id: userId,
              role_id: role.role_id,
              tenant
            });
          } else {
            console.warn(`Role not found: ${member.role.toLowerCase()} for tenant ${tenant}`);
            // Try to assign a default role
            const defaultRole = await trx('roles')
              .where({ tenant, msp: true })
              .orderBy('role_name')
              .first();
            
            if (defaultRole) {
              await trx('user_roles').insert({
                user_id: userId,
                role_id: defaultRole.role_id,
                tenant
              });
            }
          }

          // Mark that the user hasn't reset their initial password
          const UserPreferences = await import('@server/lib/models/userPreferences').then(m => m.default);
          await UserPreferences.upsert(trx, {
            user_id: userId,
            setting_name: 'has_reset_password',
            setting_value: false,
            updated_at: new Date()
          });

          created.push(member.email);
        } catch (memberError) {
          failed.push({ 
            member, 
            error: memberError instanceof Error ? memberError.message : 'Unknown error' 
          });
        }
      }

      // Save progress - store successful team members
      const successfulMembers = membersToProcess.filter(m => 
        created.includes(m.email)
      );
      await saveTenantOnboardingProgress({
        teamMembers: successfulMembers
      });
    });


    revalidatePath('/msp/onboarding');
    
    // Include warning message if some users were skipped
    let message: string | undefined = undefined;
    if (skippedDueToLimit.length > 0) {
      message = `License limit reached. ${created.length} user(s) created, ${skippedDueToLimit.length} skipped: ${skippedDueToLimit.join(', ')}`;
    }
    
    return { 
      success: true, 
      data: { 
        created, 
        alreadyExists,
        failed, 
        skippedDueToLimit,
        licenseStatus: { current: usage.used + created.length, limit: usage.limit },
        message
      }
    };
  } catch (error) {
    console.error('Error adding team members:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function createClient(data: ClientData): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    const { knex } = await createTenantKnex();

    let clientId: string | undefined = data.clientId;

    // If we have an existing clientId, update instead of create
    if (clientId) {
      await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Update the client
        await trx('clients')
          .where({ client_id: clientId, tenant })
          .update({
            client_name: data.clientName,
            url: data.clientUrl,
            updated_at: new Date()
          });

        // Update the default location if email or phone changed
        const defaultLocation = await trx('client_locations')
          .where({ client_id: clientId, tenant, is_default: true })
          .first();

        if (defaultLocation && (data.clientEmail || data.clientPhone)) {
          await trx('client_locations')
            .where({ location_id: defaultLocation.location_id, tenant })
            .update({
              email: data.clientEmail || defaultLocation.email || '',
              phone: data.clientPhone || defaultLocation.phone || '',
              updated_at: new Date()
            });
        }
      });

      await saveTenantOnboardingProgress({
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        clientUrl: data.clientUrl,
        clientId: clientId
      });

      revalidatePath('/msp/onboarding');
      return { 
        success: true, 
        data: { clientId: clientId, updated: true }
      };
    }

    // Create new client
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Create the client without email/phone (those go in locations)
      const clientData = {
        client_name: data.clientName,
        url: data.clientUrl,
        credit_balance: 0,
        is_inactive: false,
        is_tax_exempt: false,
        billing_cycle: 'monthly' as const,
        client_type: 'company' as const,
        tenant
      };

      // Use createClientInternal for consistency and to get all the default setup
      const result = await createClientInternal(clientData);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create client');
      }

      clientId = result.data.client_id;

      // Create default location with email and phone if provided
      if (data.clientEmail || data.clientPhone) {
        await trx('client_locations').insert({
          location_id: require('crypto').randomUUID(),
          client_id: clientId,
          tenant,
          location_name: 'Main Office',
          email: data.clientEmail || '',
          phone: data.clientPhone || '',
          address_line1: '',
          city: '',
          country_code: 'US',
          country_name: 'United States',
          is_default: true,
          is_billing_address: true,
          is_shipping_address: true,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    });

    if (clientId) {
      await saveTenantOnboardingProgress({
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        clientUrl: data.clientUrl,
        clientId: clientId
      });

      revalidatePath('/msp/onboarding');
      return { 
        success: true, 
        data: { clientId: clientId }
      };
    }

    return { success: false, error: 'Failed to create client' };
  } catch (error) {
    console.error('Error creating client:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function addClientContact(data: ClientContactData): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    const { knex } = await createTenantKnex();

    // First, check if a contact with this email already exists for this client
    const existingContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ 
          email: data.contactEmail.toLowerCase(),
          client_id: data.clientId,
          tenant 
        })
        .first();
    });

    if (existingContact) {
      // Contact already exists, update it if details have changed
      const needsUpdate = 
        existingContact.full_name !== data.contactName ||
        existingContact.role !== data.contactRole;

      if (needsUpdate) {
        await withTransaction(knex, async (trx: Knex.Transaction) => {
          await trx('contacts')
            .where({ 
              contact_name_id: existingContact.contact_name_id,
              tenant 
            })
            .update({
              full_name: data.contactName,
              role: data.contactRole,
              updated_at: new Date()
            });
        });
      }

      await saveTenantOnboardingProgress({
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        contactRole: data.contactRole
      });

      revalidatePath('/msp/onboarding');
      return { 
        success: true, 
        data: { 
          contactId: existingContact.contact_name_id,
          alreadyExisted: true,
          updated: needsUpdate
        }
      };
    }

    // Contact doesn't exist, create it
    const result = await createClientContact({
      clientId: data.clientId,
      fullName: data.contactName,
      email: data.contactEmail,
      jobTitle: data.contactRole
    });

    await saveTenantOnboardingProgress({
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactRole: data.contactRole
    });

    revalidatePath('/msp/onboarding');
    return { 
      success: true, 
      data: { contactId: result.contact?.contact_name_id }
    };
  } catch (error) {
    console.error('Error adding client contact:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setupBilling(data: BillingData): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    const { knex } = await createTenantKnex();

    let serviceId: string | undefined;

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Use the selected service type
      if (!data.serviceTypeId) {
        throw new Error('Service type is required');
      }

      // Verify the service type exists
      const serviceType = await trx('service_types')
        .where({ 
          id: data.serviceTypeId,
          tenant: tenant,
          is_active: true
        })
        .first();

      if (!serviceType) {
        throw new Error('Invalid service type selected');
      }

      // Create service catalog entry
      serviceId = require('crypto').randomUUID();
      await trx('service_catalog').insert({
        service_id: serviceId,
        tenant,
        service_name: data.serviceName,
        description: data.serviceDescription,
        billing_method: serviceType.billing_method || 'usage',
        custom_service_type_id: serviceType.id,
        default_rate: parseFloat(data.servicePrice) || 0,
        unit_of_measure: 'hour'
      });

      // Save progress
      await saveTenantOnboardingProgress({
        serviceName: data.serviceName,
        serviceDescription: data.serviceDescription,
        servicePrice: data.servicePrice,
        contractLineName: data.contractLineName
      });
    });

    revalidatePath('/msp/onboarding');
    return { success: true, data: { serviceId } };
  } catch (error) {
    console.error('Error setting up billing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function configureTicketing(data: TicketingData): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    const { knex } = await createTenantKnex();

    const createdIds: Record<string, string[]> = {
      boardId: [],
      categoryIds: [],
      priorityIds: []
    };

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Configure ticket numbering - check if any numbering field is explicitly set
      if (data.ticketPrefix !== undefined || data.ticketStartNumber !== undefined || data.ticketPaddingLength !== undefined) {
        const existingNumbering = await trx('next_number')
          .where({ tenant, entity_type: 'TICKET' })
          .first();

        if (existingNumbering) {
          await trx('next_number')
            .where({ tenant, entity_type: 'TICKET' })
            .update({
              prefix: data.ticketPrefix ?? '',
              padding_length: data.ticketPaddingLength ?? 6,
              ...(data.ticketStartNumber && { 
                last_number: 0,
                initial_value: data.ticketStartNumber 
              })
            });
        } else {
          await trx('next_number').insert({
            tenant,
            entity_type: 'TICKET',
            prefix: data.ticketPrefix ?? '',
            padding_length: data.ticketPaddingLength ?? 6,
            last_number: 0,
            initial_value: data.ticketStartNumber || 1
          });
        }
      }

      // Handle board creation or import
      let boardId: string = '';
      
      if (data.boardId) {
        // This is an imported board
        boardId = data.boardId;
        const shouldBeDefault = data.isDefaultBoard || false;
        
        // If this imported board should be default, clear existing defaults first
        if (shouldBeDefault) {
          await trx('boards')
            .where({ 
              tenant,
              is_default: true
            })
            .update({ is_default: false });
            
          // Set the imported board as default
          await trx('boards')
            .where({
              tenant,
              board_id: boardId
            })
            .update({ is_default: true });
        }
        
        createdIds.boardId.push(boardId);
      } else if (data.boardName) {
        // This is a manually created board
        boardId = require('crypto').randomUUID();
        const shouldBeDefault = data.isDefaultBoard || false;
        
        // If setting as default, clear any existing defaults first
        if (shouldBeDefault) {
          await trx('boards')
            .where({ 
              tenant,
              is_default: true
            })
            .update({ is_default: false });
        }
        
        await trx('boards').insert({
          board_id: boardId,
          tenant,
          board_name: data.boardName,
          email: data.supportEmail,
          is_active: true,
          is_default: shouldBeDefault
        });
        
        createdIds.boardId.push(boardId);
      }

      // Create categories only if we have a board
      if (boardId && data.categories) {
        for (const category of data.categories) {
          // Skip if already has a real ID (imported category)
          if (typeof category === 'object' && category.category_id && !category.category_id.startsWith('manual-')) {
            continue;
          }
          
          const categoryName = typeof category === 'string' ? category : category.category_name;
          const categoryId = require('crypto').randomUUID();
          
          // Check if category already exists
          const existingCategory = await trx('categories')
            .where({ 
              tenant, 
              category_name: categoryName,
              board_id: boardId
            })
            .first();
          
        if (!existingCategory) {
          // Calculate display order to avoid duplicates
          let displayOrder = typeof category === 'object' && category.display_order ? category.display_order : null;
          
          if (displayOrder !== null) {
            // Check if this display order already exists for this board
            const existingWithOrder = await trx('categories')
              .where({ 
                tenant, 
                board_id: boardId,
                display_order: displayOrder
              })
              .first();
              
            if (existingWithOrder) {
              // Find the max display order and add 1
              const maxOrder = await trx('categories')
                .where({ tenant, board_id: boardId })
                .max('display_order as max')
                .first();
              displayOrder = (maxOrder?.max || 0) + 1;
            }
          }
          
          await trx('categories').insert({
            category_id: categoryId,
            tenant,
            category_name: categoryName,
            board_id: boardId,
            display_order: displayOrder,
            parent_category: typeof category === 'object' ? category.parent_category : null,
            created_by: currentUser.user_id,
            created_at: new Date()
          });
          createdIds.categoryIds.push(categoryId);
        }
      }
      }

      // Create statuses - only ones that don't exist
      if (data.statuses && data.statuses.length > 0) {
        // Check if any status (imported or manual) should be the default
        const defaultStatus = data.statuses.find(s => s.is_default);
        
        // If we have a default status, clear existing defaults first
        if (defaultStatus) {
          await trx('statuses')
            .where({ 
              tenant, 
              item_type: 'ticket',
              is_default: true
            })
            .update({ is_default: false });
        }
        
        for (const status of data.statuses) {
          // Skip imported statuses that already exist (they have real IDs, not manual-)
          if (status.status_id && !status.status_id.startsWith('manual-')) {
            // For imported statuses, we might need to update their default flag
            if (status.is_default) {
              await trx('statuses')
                .where({
                  tenant,
                  status_id: status.status_id
                })
                .update({ is_default: true });
            }
            continue;
          }
          
          // Check if status already exists
          const existingStatus = await trx('statuses')
            .where({ 
              tenant, 
              name: status.name,
              status_type: 'ticket'
            })
            .first();

          if (!existingStatus) {
            const statusId = require('crypto').randomUUID();
            await trx('statuses').insert({
              status_id: statusId,
              tenant,
              name: status.name,
              is_closed: status.is_closed || false,
              is_default: status.is_default || false,
              order_number: status.order_number || 0,
              item_type: 'ticket',
              status_type: 'ticket',
              created_at: new Date()
            });
          }
        }
      }

      // Create priorities - only manual ones, imported ones are already in DB
      for (let i = 0; i < data.priorities.length; i++) {
        const priority = data.priorities[i];
        
        // Skip if already has a real ID (imported priority)
        if (typeof priority === 'object' && priority.priority_id && !priority.priority_id.startsWith('manual-')) {
          continue;
        }
        
        const priorityName = typeof priority === 'string' ? priority : priority.priority_name;
        
        // Check if priority already exists (might have been imported)
        const existingPriority = await trx('priorities')
          .where({ 
            tenant, 
            priority_name: priorityName,
            item_type: 'ticket'
          })
          .first();

        if (!existingPriority) {
          const priorityId = require('crypto').randomUUID();
          await trx('priorities').insert({
            priority_id: priorityId,
            tenant,
            priority_name: priorityName,
            color: typeof priority === 'object' && priority.color ? priority.color : ['#ff0000', '#ff8800', '#ffff00', '#00ff00'][i] || '#888888',
            order_number: typeof priority === 'object' && priority.order_number ? priority.order_number : (i + 1) * 10,
            item_type: 'ticket',
            created_by: currentUser.user_id,
            created_at: new Date(),
            updated_at: new Date()
          });
          createdIds.priorityIds.push(priorityId);
        }
      }

      // Save progress - convert categories and priorities to strings
      await saveTenantOnboardingProgress({
        boardName: data.boardName,
        supportEmail: data.supportEmail,
        categories: data.categories.map(cat => typeof cat === 'string' ? cat : cat.category_name),
        priorities: data.priorities.map(pri => typeof pri === 'string' ? pri : pri.priority_name),
        ticketPrefix: data.ticketPrefix,
        ticketStartNumber: data.ticketStartNumber
      });
    });

    revalidatePath('/msp/onboarding');
    return { success: true, data: createdIds };
  } catch (error) {
    console.error('Error configuring ticketing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function validateOnboardingDefaults(): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    // Check permission to configure ticket settings
    const canConfigureTicketing = await hasPermission(currentUser, 'ticket_settings', 'update');
    if (!canConfigureTicketing) {
      return { success: false, error: 'You do not have permission to configure ticket settings' };
    }

    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      return { success: false, error: 'Unable to identify tenant. Please refresh and try again.' };
    }
    
    // Use withTransaction to check for defaults
    const validationResult = await withTransaction(db, async (trx) => {
      // Check for default board
      const defaultBoard = await trx('boards')
        .where({ 
          is_default: true,
          tenant 
        })
        .first();
      
      if (!defaultBoard) {
        return { valid: false, error: 'No default board is set. Please set one board as default before completing setup.' };
      }
      
      // Check for default status
      const defaultStatus = await trx('statuses')
        .where({ 
          is_default: true,
          status_type: 'ticket',
          tenant
        })
        .first();
      
      if (!defaultStatus) {
        return { valid: false, error: 'No default status is set. Please set one status as default before completing setup.' };
      }
      
      return { valid: true };
    });
    
    if (!validationResult.valid) {
      return { success: false, error: validationResult.error };
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error validating onboarding defaults:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function completeOnboarding(): Promise<OnboardingActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    // Mark onboarding as completed and clear wizard data
    await updateTenantOnboardingStatus(true);

    revalidatePath('/msp');
    revalidatePath('/msp/onboarding');
    
    return { success: true };
  } catch (error) {
    console.error('Error completing onboarding:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getAvailableRoles(): Promise<{
  success: boolean;
  data?: Array<{ value: string; label: string }>;
  error?: string;
}> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const { knex } = await createTenantKnex();
    
    const roles = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('roles')
        .where({ 
          tenant: currentUser.tenant,
          msp: true  // Only fetch MSP roles
        })
        .select('role_id', 'role_name')
        .orderBy('role_name');
    });

    // Transform roles to the format expected by the select component
    const roleOptions = roles.map(role => ({
      value: role.role_name,
      label: role.role_name.charAt(0).toUpperCase() + role.role_name.slice(1) // Capitalize first letter
    }));

    return {
      success: true,
      data: roleOptions
    };
  } catch (error) {
    console.error('Error fetching available roles:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function getOnboardingInitialData(): Promise<{
  success: boolean;
  data?: Partial<ClientInfoData>;
  error?: string;
}> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    const { knex } = await createTenantKnex();

    // Get the tenant's client information
    const client = await knex('clients')
      .where({ tenant, is_inactive: false })
      .orderBy('created_at', 'asc')
      .first();

    return {
      success: true,
      data: {
        firstName: currentUser.first_name || '',
        lastName: currentUser.last_name || '',
        email: currentUser.email || '',
        clientName: client?.client_name || tenant // Use tenant name as fallback
      }
    };
  } catch (error) {
    console.error('Error getting onboarding initial data:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function getTenantTicketingData(): Promise<{
  success: boolean;
  data?: {
    boards: any[];
    categories: any[];
    statuses: any[];
    priorities: any[];
  };
  error?: string;
}> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    const { knex } = await createTenantKnex();

    const [boards, categories, statuses, priorities] = await Promise.all([
      // Get boards
      knex('boards')
        .where({ tenant })
        .orderBy('display_order', 'asc')
        .orderBy('board_name', 'asc'),

      // Get categories
      knex('categories')
        .where({ tenant })
        .orderBy('display_order', 'asc')
        .orderBy('category_name', 'asc'),

      // Get statuses
      knex('statuses')
        .where({ tenant, status_type: 'ticket' })
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc'),

      // Get priorities
      knex('priorities')
        .where({ tenant, item_type: 'ticket' })
        .orderBy('order_number', 'asc')
        .orderBy('priority_name', 'asc')
    ]);

    return {
      success: true,
      data: {
        boards,
        categories,
        statuses,
        priorities
      }
    };
  } catch (error) {
    console.error('Error getting tenant ticketing data:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
