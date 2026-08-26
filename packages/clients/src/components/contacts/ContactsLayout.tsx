import { IContact } from '@alga-psa/types';
import Contacts from './Contacts';

interface ContactsLayoutProps {
  uniqueContacts: IContact[];
}

export default function ContactsLayout({ uniqueContacts }: ContactsLayoutProps) {
  return <Contacts initialContacts={uniqueContacts} />;
}
