import type { IContact } from '@alga-psa/types';
import { getAllClients, getAllContacts } from '@alga-psa/clients/actions/queryActions';
import { getTelephonyOverview } from '@alga-psa/integrations/actions/integrations/telephonyActions';
import { getAllUsersBasic } from '@alga-psa/user-composition/actions/userQueryActions';

export async function loadMspInteractionsPageData() {
  const [contacts, users, clients, telephonyOverview] = await Promise.all([
    getAllContacts('all'),
    getAllUsersBasic(true),
    getAllClients(true),
    getTelephonyOverview().catch(() => null),
  ]);

  const uniqueContacts = Array.from(
    new Map(contacts.map((contact): [string, IContact] => [contact.contact_name_id, contact])).values(),
  );

  return {
    users,
    contacts: uniqueContacts,
    clients,
    telephonyOverview,
  };
}

export type MspInteractionsPageData = Awaited<ReturnType<typeof loadMspInteractionsPageData>>;
