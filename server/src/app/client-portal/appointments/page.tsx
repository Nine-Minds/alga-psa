import { AppointmentsPage as ClientPortalAppointmentsPage } from '@alga-psa/client-portal/components';
import { getClientPortalFeatureSettings } from '@alga-psa/client-portal/actions/client-portal-actions/clientPortalFeatureSettingsActions';
import { redirect } from 'next/navigation';

export default async function AppointmentsPage() {
  const portalFeatureSettings = await getClientPortalFeatureSettings();
  if (!portalFeatureSettings.appointmentsEnabled) {
    redirect('/client-portal/dashboard');
  }

  return <ClientPortalAppointmentsPage />;
}
