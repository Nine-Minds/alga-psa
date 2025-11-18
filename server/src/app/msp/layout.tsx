import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionWithRevocationCheck } from "server/src/lib/auth/getSession";
import { getTenantSettings } from "server/src/lib/actions/tenant-settings-actions/tenantSettingsActions";
import { MspLayoutClient } from "./MspLayoutClient";
import { getSessionCookieConfig } from "server/src/lib/auth/sessionCookies";

export default async function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Use the full auth with revocation checks in the layout
  // This ensures revoked sessions are caught on every page navigation
  const session = await getSessionWithRevocationCheck();
  const cookieStore = await cookies();
  const sessionCookieConfig = getSessionCookieConfig();

  // If session is null, handle appropriately
  if (!session) {
    const hasCookie = cookieStore.has(sessionCookieConfig.name);

    if (hasCookie) {
      // Had a cookie but session is null - likely revoked
      console.log('[msp-layout] Session invalid or revoked, clearing cookie and redirecting');
      cookieStore.delete(sessionCookieConfig.name);
    }

    // Always redirect to signin if no session
    redirect('/auth/msp/signin?error=SessionRevoked');
  }

  // Check if user is trying to access wrong portal
  if (session.user.user_type === 'client') {
    console.log('[msp-layout] Client user trying to access MSP portal, redirecting to switch prompt');
    redirect('/auth/msp/signin');
  }

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
