import type { Metadata } from 'next';
import CreateServiceRouteClient from '../../_components/CreateServiceRouteClient';

export const metadata: Metadata = {
  title: 'Create Service',
};

export default function CreateServiceModalPage() {
  return <CreateServiceRouteClient closeMode="back" />;
}
