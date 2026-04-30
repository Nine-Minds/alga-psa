import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alga Appliance Status',
  description: 'Early bootstrap and readiness dashboard for the Alga PSA appliance.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
