import type { Metadata } from 'next';
import CreateContactRouteClient from '../_components/CreateContactRouteClient';

export const metadata: Metadata = {
  title: 'Create Contact',
};

export default function CreateContactPage() {
  return <CreateContactRouteClient closeMode="replace" />;
}
