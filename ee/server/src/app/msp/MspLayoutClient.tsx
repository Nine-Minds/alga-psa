"use client";

import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import DefaultLayout from "@/components/layout/DefaultLayout";
import { TenantProvider } from "@/components/TenantProvider";
import { ClientUIStateProvider } from "server/src/types/ui-reflection/ClientUIStateProvider";
import type { Session } from "next-auth";

interface Props {
  children: React.ReactNode;
  session: Session | null;
}

export function MspLayoutClient({ children, session }: Props) {
  return (
    <AppSessionProvider session={session}>
      <TenantProvider>
        <ClientUIStateProvider
          initialPageState={{ id: 'ee-msp', title: 'EE MSP', components: [] }}
        >
          <DefaultLayout>
            {children}
          </DefaultLayout>
        </ClientUIStateProvider>
      </TenantProvider>
    </AppSessionProvider>
  );
}
