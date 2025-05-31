import { redirect } from 'next/navigation';

export default function ExtensionsPage() {
  // Redirect to main settings page with extensions tab
  redirect('/msp/settings?tab=extensions');
}