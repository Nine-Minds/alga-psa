import { Toaster } from 'react-hot-toast';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Onboarding',
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Onboarding has its own layout without navigation
  return (
    <div className="min-h-screen">
      {children}
      <Toaster position="top-right" />
    </div>
  );
}
