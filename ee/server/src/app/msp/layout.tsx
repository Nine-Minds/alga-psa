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
  return (
    <MspLayoutClient session={session}>
      {children}
    </MspLayoutClient>
  );
}
