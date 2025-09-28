import { cookies } from "next/headers";
import { getSession } from "server/src/lib/auth/getSession";
import { MspLayoutClient } from "./MspLayoutClient";

/**
 * MSP Layout for Enterprise Edition
 * 
 * This layout provides the standard MSP interface (sidebar, header, main content)
 * for all MSP pages in the Enterprise Edition, including extension pages.
 * 
 * It ensures that extensions are rendered within the main application layout
 * rather than taking over the entire screen.
 */
export default async function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_collapsed')?.value;
  const initialSidebarCollapsed = sidebarCookie === 'true';
  return (
    <MspLayoutClient session={session} initialSidebarCollapsed={initialSidebarCollapsed}>
      {children}
    </MspLayoutClient>
  );
}
