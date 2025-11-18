import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "server/src/lib/auth/getSession";
import { getTenantSettings } from "server/src/lib/actions/tenant-settings-actions/tenantSettingsActions";
import { MspLayoutClient } from "./MspLayoutClient";
import { UserSession } from "server/src/lib/models/UserSession";
import { getSessionCookieConfig } from "server/src/lib/auth/sessionCookies";

export default async function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  // Check if session has been revoked (force logout on every page load)
  if (session?.session_id && session?.user?.tenant) {
    try {
      const isRevoked = await UserSession.isRevoked(
        session.user.tenant,
        (session as any).session_id
      );

      if (isRevoked) {
        console.log('[msp-layout] Session revoked, clearing cookie and redirecting:', (session as any).session_id);

        // Clear the session cookie to force logout
        const cookieStore = await cookies();
        const sessionCookieConfig = getSessionCookieConfig();
        cookieStore.delete(sessionCookieConfig.name);

        redirect('/auth/msp/signin?error=SessionRevoked');
      }
    } catch (error) {
      console.error('[msp-layout] Session revocation check failed:', error);
      // Don't block on errors
    }
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
