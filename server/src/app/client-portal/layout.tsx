import { getSession } from "server/src/lib/auth/getSession";
import { ClientPortalLayoutClient } from "./ClientPortalLayoutClient";

export default async function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  return (
    <ClientPortalLayoutClient session={session}>
      {children}
    </ClientPortalLayoutClient>
  );
}
