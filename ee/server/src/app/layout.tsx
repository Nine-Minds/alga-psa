import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s | AlgaPSA',
    default: 'AlgaPSA',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
