'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';
import { getTenantForCurrentRequest } from 'server/src/lib/tenant';
import { revalidatePath } from 'next/cache';
import { withTransaction } from '@shared/db';
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
}

export interface TicketingData {
  channelName: string;
  supportEmail: string;
  categories: string[];
  priorities: string[];
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
      await trx('users')
        .where({ user_id: currentUser.user_id, tenant })
        .update({
          first_name: data.firstName,
          last_name: data.lastName,
          email: data.email.toLowerCase(),
          updated_at: new Date()
        });

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
        existingContact.job_title !== data.contactRole;

      if (needsUpdate) {
        await withTransaction(knex, async (trx: Knex.Transaction) => {
          await trx('contacts')
            .where({ 
              contact_name_id: existingContact.contact_name_id,
              tenant 
            })
            .update({
              full_name: data.contactName,
              job_title: data.contactRole,
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

    let billingId: string | undefined;

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Create service type
      const serviceTypeId = require('crypto').randomUUID();
      await trx('service_types').insert({
        service_type_id: serviceTypeId,
        tenant,
        type_name: data.serviceName,
        description: data.serviceDescription,
        hourly_rate: parseFloat(data.servicePrice) || 0,
        created_at: new Date(),
        updated_at: new Date()
      });

      // Create billing plan
      billingId = require('crypto').randomUUID();
      await trx('billing_plans').insert({
        billing_plan_id: billingId,
        tenant,
        plan_name: data.planName,
        plan_type: 'hourly',
        created_at: new Date(),
        updated_at: new Date()
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
    return { success: true, data: { billingId } };
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
      // Create channel
      const channelId = require('crypto').randomUUID();
      await trx('channels').insert({
        channel_id: channelId,
        tenant,
        channel_name: data.channelName,
        email: data.supportEmail,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });
      createdIds.channelId.push(channelId);

      // Create categories
      for (const categoryName of data.categories) {
        const categoryId = require('crypto').randomUUID();
        await trx('ticket_categories').insert({
          category_id: categoryId,
          tenant,
          category_name: categoryName,
          channel_id: channelId,
          created_at: new Date(),
          updated_at: new Date()
        });
        createdIds.categoryIds.push(categoryId);
      }

      // Create priorities
      for (let i = 0; i < data.priorities.length; i++) {
        const priorityId = require('crypto').randomUUID();
        await trx('priorities').insert({
          priority_id: priorityId,
          tenant,
          priority_name: data.priorities[i],
          color_code: ['#ff0000', '#ff8800', '#ffff00', '#00ff00'][i] || '#888888',
          sort_order: i + 1,
          created_at: new Date(),
          updated_at: new Date()
        });
        createdIds.priorityIds.push(priorityId);
      }

      // Save progress
      await saveTenantOnboardingProgress({
        channelName: data.channelName,
        supportEmail: data.supportEmail,
        categories: data.categories,
        priorities: data.priorities
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