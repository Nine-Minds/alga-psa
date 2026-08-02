import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Add-ons',
};

export default function AddOnsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
