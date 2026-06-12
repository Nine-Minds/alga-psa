import type { Metadata } from 'next';
import './globals.css';
import { AuthGate } from './auth/AuthGate';

export const metadata: Metadata = {
  title: 'Alga Appliance Status',
  description: 'Early bootstrap and readiness dashboard for the Alga PSA appliance.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
