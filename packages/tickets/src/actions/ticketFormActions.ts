'use server'

import type { IUser, IBoard, ITicketStatus, IPriority, IClient, IContact } from '@alga-psa/types';
import { getAllUsers } from '@alga-psa/users/actions';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { getAllBoards } from './board-actions';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { getAllPriorities, getPrioritiesByBoardType } from '@alga-psa/reference-data/actions';
import { getAllClients, getClientById, getContactsByClient } from './clientLookupActions';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';

export interface TicketFormData {
  users: IUser[];
  boards: IBoard[];
  statuses: ITicketStatus[];
  priorities: IPriority[];
  clients: IClient[];
  contacts?: IContact[];
  selectedClient?: {
    client_id: string;
    client_name: string;
    client_type: string;
  };
}

export async function getTicketFormData(prefilledClientId?: string): Promise<TicketFormData> {
  try {
    // Get current user first to ensure tenant context
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('No active session found');
    }

    // Fetch required data first
    const [users, boards, statuses, priorities, clients] = await Promise.all([
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
      getAllClients(false).catch(error => {
        console.error('Error fetching clients:', error);
        return [];
      })
    ]);

    // Handle optional prefilled client data separately
    let selectedClient: any | null = null;
    let contacts: IContact[] = [];

    if (prefilledClientId) {
      try {
        selectedClient = await getClientById(prefilledClientId);
        if (selectedClient?.client_type === 'company') {
          contacts = await getContactsByClient(selectedClient.client_id).catch(() => []);
        }
      } catch (error) {
        console.error('Error fetching prefilled client data:', error);
        // Continue without the prefilled data
      }
    }

    return {
      users: users || [],
      boards: boards || [],
      statuses: statuses || [],
      priorities: priorities || [],
      clients: clients || [],
      contacts: contacts.length > 0 ? contacts : undefined,
      selectedClient: selectedClient && selectedClient.client_type ? {
        client_id: selectedClient.client_id,
        client_name: selectedClient.client_name,
        client_type: selectedClient.client_type
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
      clients: [],
    };
  }
}

export async function getClientTicketFormData(): Promise<Partial<TicketFormData>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);

    // Get the default board for client portal tickets
    const defaultBoard = await withTransaction(db, async (trx: Knex.Transaction) => {
      const board = await trx('boards')
        .select('board_id', 'priority_type')
        .where({ tenant, is_default: true })
        .first();

      return board;
    });

    if (!defaultBoard) {
      throw new Error('No default board found for client portal tickets');
    }

    // Get priorities filtered by the default board's priority type
    const priorities = await getPrioritiesByBoardType(defaultBoard.board_id, 'ticket').catch((error: unknown) => {
      console.error('Error fetching priorities for default board:', error);
      return [];
    });

    return {
      priorities,
      // Other fields are not needed for client portal ticket creation
      users: [],
      boards: [],
      statuses: [],
      clients: [],
    };
  } catch (error) {
    console.error('Error fetching client ticket form data:', error);
    return {
      users: [],
      boards: [],
      statuses: [],
      priorities: [],
      clients: [],
    };
  }
}
