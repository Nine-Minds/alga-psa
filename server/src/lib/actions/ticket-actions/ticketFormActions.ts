'use server'

import { IUser, IBoard, ITicketStatus, IPriority, ICompany, IContact } from 'server/src/interfaces';
import { getAllUsers, getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getAllBoards } from 'server/src/lib/actions/board-actions/boardActions';
import { getTicketStatuses } from 'server/src/lib/actions/status-actions/statusActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getAllCompanies, getCompanyById } from 'server/src/lib/actions/company-actions/companyActions';
import { getContactsByCompany } from 'server/src/lib/actions/contact-actions/contactActions';

export interface TicketFormData {
  users: IUser[];
  boards: IBoard[];
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
    const [users, boards, statuses, priorities, companies] = await Promise.all([
      getAllUsers(false).catch(error => {
        console.error('Error fetching users:', error);
        return [];
      }),
      getAllBoards().catch(error => {
        console.error('Error fetching boards:', error);
        return [];
      }),
      getTicketStatuses().catch(error => {
        console.error('Error fetching statuses:', error);
        return [];
      }),
      getAllPriorities('ticket').catch(error => {
        console.error('Error fetching priorities:', error);
        return [];
      }),
      getAllCompanies(false).catch(error => {
        console.error('Error fetching companies:', error);
        return [];
      })
    ]);

    // Handle optional prefilled company data separately
    let selectedCompany: any | null = null;
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
      boards: boards || [],
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
      boards: [],
      statuses: [],
      priorities: [],
      companies: [],
    };
  }
}

export async function getClientTicketFormData(): Promise<Partial<TicketFormData>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Client portal users only need priorities for ticket creation
    // Companies are handled automatically based on the user's associated company
    const priorities = await getAllPriorities('ticket').catch(error => {
      console.error('Error fetching priorities:', error);
      return [];
    });

    return {
      priorities,
      // Other fields are not needed for client portal ticket creation
      users: [],
      boards: [],
      statuses: [],
      companies: [],
    };
  } catch (error) {
    console.error('Error fetching client ticket form data:', error);
    return {
      users: [],
      boards: [],
      statuses: [],
      priorities: [],
      companies: [],
    };
  }
}
