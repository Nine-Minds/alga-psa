'use server'

import { IUser, IChannel, ITicketStatus, IPriority, ICompany, IContact } from 'server/src/interfaces';
import { getAllUsers, getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getAllChannels } from 'server/src/lib/actions/channel-actions/channelActions';
import { getTicketStatuses } from 'server/src/lib/actions/status-actions/statusActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getAllCompanies, getCompanyById } from 'server/src/lib/actions/companyActions';
import { getContactsByCompany } from 'server/src/lib/actions/contact-actions/contactActions';

export interface TicketFormData {
  users: IUser[];
  channels: IChannel[];
  statuses: ITicketStatus[];
  priorities: IPriority[];
  companies: ICompany[];
  contacts?: IContact[];
  selectedCompany?: {
    company_id: string;
    company_name: string;
    client_type: string;
  };
}

export async function getTicketFormData(prefilledCompanyId?: string): Promise<TicketFormData> {
  try {
    // Get current user first to ensure tenant context
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('No active session found');
    }

    // Fetch required data first
    const [users, channels, statuses, priorities, companies] = await Promise.all([
      getAllUsers().catch(error => {
        console.error('Error fetching users:', error);
        return [];
      }),
      getAllChannels().catch(error => {
        console.error('Error fetching channels:', error);
        return [];
      }),
      getTicketStatuses().catch(error => {
        console.error('Error fetching statuses:', error);
        return [];
      }),
      getAllPriorities().catch(error => {
        console.error('Error fetching priorities:', error);
        return [];
      }),
      getAllCompanies(false).catch(error => {
        console.error('Error fetching companies:', error);
        return [];
      })
    ]);

    // Handle optional prefilled company data separately
    let selectedCompany = null;
    let contacts: IContact[] = [];

    if (prefilledCompanyId) {
      try {
        selectedCompany = await getCompanyById(prefilledCompanyId);
        if (selectedCompany?.client_type === 'company') {
          contacts = await getContactsByCompany(selectedCompany.company_id).catch(() => []);
        }
      } catch (error) {
        console.error('Error fetching prefilled company data:', error);
        // Continue without the prefilled data
      }
    }

    return {
      users: users || [],
      channels: channels || [],
      statuses: statuses || [],
      priorities: priorities || [],
      companies: companies || [],
      contacts: contacts.length > 0 ? contacts : undefined,
      selectedCompany: selectedCompany && selectedCompany.client_type ? {
        company_id: selectedCompany.company_id,
        company_name: selectedCompany.company_name,
        client_type: selectedCompany.client_type
      } : undefined
    };
  } catch (error) {
    console.error('Error fetching ticket form data:', error);
    // Return empty data instead of throwing
    return {
      users: [],
      channels: [],
      statuses: [],
      priorities: [],
      companies: [],
    };
  }
}
