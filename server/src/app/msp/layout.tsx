import { getSession } from "server/src/lib/auth/getSession";
import { MspLayoutClient } from "./MspLayoutClient";

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
