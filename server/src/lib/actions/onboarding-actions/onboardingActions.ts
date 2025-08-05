'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';
import { getTenantForCurrentRequest } from 'server/src/lib/tenant';
import { revalidatePath } from 'next/cache';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import { createCompany } from 'server/src/lib/actions/company-actions/companyActions';
import { createCompanyContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { getLicenseChecker } from 'server/src/lib/licensing';
import { updateTenantOnboardingStatus, saveTenantOnboardingProgress } from 'server/src/lib/actions/tenant-settings-actions/tenantSettingsActions';

export interface OnboardingActionResult {
  success: boolean;
  error?: string;
  data?: any;
}

export interface CompanyInfoData {
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  newPassword?: string;
}

export interface TeamMember {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
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
  planName: string;
  serviceTypeId?: string;
}

export interface TicketingData {
  channelName: string;
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
  channelId?: string;
  statuses?: any[];
}

export async function saveCompanyInfo(data: CompanyInfoData): Promise<OnboardingActionResult> {
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
      // Update current user with company owner information
      const updateData: any = {
        first_name: data.firstName,
        last_name: data.lastName,
        email: data.email.toLowerCase(),
        updated_at: new Date()
      };
      
      // If new password is provided, hash and update it
      if (data.newPassword) {
        updateData.hashed_password = await hashPassword(data.newPassword);
      }
      
      await trx('users')
        .where({ user_id: currentUser.user_id, tenant })
        .update(updateData);

      // Save progress to tenant settings
      await saveTenantOnboardingProgress({
        firstName: data.firstName,
        lastName: data.lastName,
        companyName: data.companyName,
        email: data.email
      });
    });

    revalidatePath('/msp/onboarding');
    return { success: true };
  } catch (error) {
    console.error('Error saving company info:', error);
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

    // Check license limits
    const { knex } = await createTenantKnex();
    const existingUsersCount = await knex('users')
      .where({ tenant })
      .count('* as count')
      .first();

    const currentCount = parseInt(existingUsersCount?.count as string || '0');
    const newTotalCount = currentCount + members.length;

    const licenseChecker = await getLicenseChecker();
    const licenseStatus = await licenseChecker.checkUserLimit(newTotalCount);

    if (!licenseStatus.allowed) {
      return { 
        success: false, 
        error: licenseStatus.message || 'User limit exceeded'
      };
    }

    const created: string[] = [];
    const alreadyExists: string[] = [];
    const failed: Array<{ member: TeamMember; error: string }> = [];

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      for (const member of members) {
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
          const tempPassword = await hashPassword('TempPassword123!');

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

          created.push(member.email);
        } catch (memberError) {
          failed.push({ 
            member, 
            error: memberError instanceof Error ? memberError.message : 'Unknown error' 
          });
        }
      }

      // Save progress - store successful team members
      const successfulMembers = members.filter(m => 
        created.includes(m.email)
      );
      await saveTenantOnboardingProgress({
        teamMembers: successfulMembers
      });
    });


    revalidatePath('/msp/onboarding');
    return { 
      success: true, 
      data: { 
        created, 
        alreadyExists,
        failed, 
        licenseStatus: { current: licenseStatus.current, limit: licenseStatus.limit }
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

    let companyId: string | undefined = data.clientId;

    // If we have an existing clientId, update instead of create
    if (companyId) {
      await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Update the company
        await trx('companies')
          .where({ company_id: companyId, tenant })
          .update({
            company_name: data.clientName,
            url: data.clientUrl,
            updated_at: new Date()
          });

        // Update the default location if email or phone changed
        const defaultLocation = await trx('company_locations')
          .where({ company_id: companyId, tenant, is_default: true })
          .first();

        if (defaultLocation && (data.clientEmail || data.clientPhone)) {
          await trx('company_locations')
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
        clientId: companyId
      });

      revalidatePath('/msp/onboarding');
      return { 
        success: true, 
        data: { clientId: companyId, updated: true }
      };
    }

    // Create new client
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Create the company without email/phone (those go in locations)
      const companyData = {
        company_name: data.clientName,
        url: data.clientUrl,
        credit_balance: 0,
        is_inactive: false,
        is_tax_exempt: false,
        billing_cycle: 'monthly' as const,
        client_type: 'company',
        tenant
      };

      // Use createCompany for consistency and to get all the default setup
      const result = await createCompany(companyData);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create company');
      }

      companyId = result.data.company_id;

      // Create default location with email and phone if provided
      if (data.clientEmail || data.clientPhone) {
        await trx('company_locations').insert({
          location_id: require('crypto').randomUUID(),
          company_id: companyId,
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

    if (companyId) {
      await saveTenantOnboardingProgress({
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        clientUrl: data.clientUrl,
        clientId: companyId
      });

      revalidatePath('/msp/onboarding');
      return { 
        success: true, 
        data: { clientId: companyId }
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

    // First, check if a contact with this email already exists for this company
    const existingContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ 
          email: data.contactEmail.toLowerCase(),
          company_id: data.clientId,
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
    const result = await createCompanyContact({
      companyId: data.clientId,
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
        billing_method: serviceType.billing_method || 'per_unit',
        custom_service_type_id: serviceType.id,
        default_rate: parseFloat(data.servicePrice) || 0,
        unit_of_measure: 'hour'
      });

      // Save progress
      await saveTenantOnboardingProgress({
        serviceName: data.serviceName,
        serviceDescription: data.serviceDescription,
        servicePrice: data.servicePrice,
        planName: data.planName
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
      channelId: [],
      categoryIds: [],
      priorityIds: []
    };

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Configure ticket numbering if provided
      if (data.ticketPrefix || data.ticketStartNumber || data.ticketPaddingLength) {
        const existingNumbering = await trx('next_number')
          .where({ tenant, entity_type: 'TICKET' })
          .first();

        if (existingNumbering) {
          await trx('next_number')
            .where({ tenant, entity_type: 'TICKET' })
            .update({
              prefix: data.ticketPrefix || 'TIC',
              padding_length: data.ticketPaddingLength || 6,
              ...(data.ticketStartNumber && { 
                last_number: 0,
                initial_value: data.ticketStartNumber 
              })
            });
        } else {
          await trx('next_number').insert({
            tenant,
            entity_type: 'TICKET',
            prefix: data.ticketPrefix || 'TIC',
            padding_length: data.ticketPaddingLength || 6,
            last_number: 0,
            initial_value: data.ticketStartNumber || 1000
          });
        }
      }

      // Create channel - use existing channelId if provided (from import)
      const channelId = data.channelId || require('crypto').randomUUID();
      
      // Only create channel if we don't have an existing one
      if (!data.channelId) {
        await trx('channels').insert({
          channel_id: channelId,
          tenant,
          channel_name: data.channelName,
          email: data.supportEmail,
          is_active: true
        });
      }
      createdIds.channelId.push(channelId);

      // Create categories
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
            channel_id: channelId
          })
          .first();
          
        if (!existingCategory) {
          // Calculate display order to avoid duplicates
          let displayOrder = typeof category === 'object' && category.display_order ? category.display_order : null;
          
          if (displayOrder !== null) {
            // Check if this display order already exists for this channel
            const existingWithOrder = await trx('categories')
              .where({ 
                tenant, 
                channel_id: channelId,
                display_order: displayOrder
              })
              .first();
              
            if (existingWithOrder) {
              // Find the max display order and add 1
              const maxOrder = await trx('categories')
                .where({ tenant, channel_id: channelId })
                .max('display_order as max')
                .first();
              displayOrder = (maxOrder?.max || 0) + 1;
            }
          }
          
          await trx('categories').insert({
            category_id: categoryId,
            tenant,
            category_name: categoryName,
            channel_id: channelId,
            display_order: displayOrder,
            parent_category: typeof category === 'object' ? category.parent_category : null,
            created_by: currentUser.user_id,
            created_at: new Date()
          });
          createdIds.categoryIds.push(categoryId);
        }
      }

      // Create statuses - only ones that don't exist
      if (data.statuses && data.statuses.length > 0) {
        for (const status of data.statuses) {
          // Skip if already has a real ID (not manual-)
          if (status.status_id && !status.status_id.startsWith('manual-')) {
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
        channelName: data.channelName,
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
  data?: Partial<CompanyInfoData>;
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

    // Get the tenant's company information
    const company = await knex('companies')
      .where({ tenant, is_inactive: false })
      .orderBy('created_at', 'asc')
      .first();

    return {
      success: true,
      data: {
        firstName: currentUser.first_name || '',
        lastName: currentUser.last_name || '',
        email: currentUser.email || '',
        companyName: company?.company_name || tenant // Use tenant name as fallback
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
    channels: any[];
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

    const [channels, categories, statuses, priorities] = await Promise.all([
      // Get channels
      knex('channels')
        .where({ tenant })
        .orderBy('display_order', 'asc')
        .orderBy('channel_name', 'asc'),

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
        channels,
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