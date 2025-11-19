import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionWithRevocationCheck } from "server/src/lib/auth/getSession";
import { getTenantSettings } from "server/src/lib/actions/tenant-settings-actions/tenantSettingsActions";
import { MspLayoutClient } from "./MspLayoutClient";

export default async function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Use the full auth with revocation checks in the layout
  // This ensures revoked sessions are caught on every page navigation
  const session = await getSessionWithRevocationCheck();

  // If session is null, redirect to signin
  // Don't include error parameter to avoid redirect loops
  if (!session) {
    console.log('[msp-layout] No session found, redirecting to signin');
    redirect('/auth/msp/signin');
  }

  // Check if user is trying to access wrong portal
  if (session.user.user_type === 'client') {
    console.log('[msp-layout] Client user trying to access MSP portal, redirecting to switch prompt');
    redirect('/auth/msp/signin');
  }

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_collapsed')?.value;
  const initialSidebarCollapsed = sidebarCookie === 'true';
  let needsOnboarding = false;
  try {
    const tenantSettings = await getTenantSettings();
    if (tenantSettings) {
      needsOnboarding = !tenantSettings.onboarding_completed && !tenantSettings.onboarding_skipped;
    }
  } catch (error) {
    console.error('Failed to load tenant settings for onboarding check:', error);
  }
  return (
    <MspLayoutClient
      session={session}
      needsOnboarding={needsOnboarding}
      initialSidebarCollapsed={initialSidebarCollapsed}
    >
      {children}
    </MspLayoutClient>
  );
}
