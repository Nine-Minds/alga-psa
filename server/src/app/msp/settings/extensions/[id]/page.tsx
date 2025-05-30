import { redirect } from 'next/navigation';

export default function ExtensionDetailsPage() {
  // Redirect to main settings page with extensions tab
  redirect('/msp/settings?tab=extensions');
}