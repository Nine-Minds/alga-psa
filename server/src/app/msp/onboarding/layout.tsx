export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Onboarding has its own layout without navigation
  return (
    <div className="min-h-screen">
      {children}
    </div>
  );
}