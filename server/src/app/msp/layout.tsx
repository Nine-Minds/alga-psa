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

  // If session is null (either not logged in or revoked), clear cookie and redirect
  if (!session) {
    const cookieStore = await cookies();
    const sessionCookieConfig = getSessionCookieConfig();
    const hasCookie = cookieStore.has(sessionCookieConfig.name);

    if (hasCookie) {
      // Had a cookie but session is null - likely revoked
      console.log('[msp-layout] Session invalid or revoked, clearing cookie');
      cookieStore.delete(sessionCookieConfig.name);
      redirect('/auth/msp/signin?error=SessionRevoked');
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
