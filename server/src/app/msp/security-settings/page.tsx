import SecuritySettingsPage from '@/components/settings/security/SecuritySettingsPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security Settings',
};

export default function Page() {
  return <SecuritySettingsPage />;
}
