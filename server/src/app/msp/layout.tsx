import { cookies } from "next/headers";
import { getSession } from "server/src/lib/auth/getSession";
import { getTenantSettings } from "@product/actions/tenant-settings-actions/tenantSettingsActions";
import { MspLayoutClient } from "./MspLayoutClient";

export default async function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
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
