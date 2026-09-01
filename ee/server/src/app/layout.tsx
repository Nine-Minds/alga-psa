import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: {
      // Brand-only: nothing here is translatable copy.
      template: '%s | AlgaPSA',
      default: 'AlgaPSA',
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
