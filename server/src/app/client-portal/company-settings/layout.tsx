import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Company Settings',
  description: 'Manage your company settings and configurations',
};

export default function ClientSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
