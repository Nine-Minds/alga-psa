"use client";

import { AppSessionProvider } from "server/src/components/providers/AppSessionProvider";
import DefaultLayout from "@/components/layout/DefaultLayout";
import { TenantProvider } from "@/components/TenantProvider";
import { ClientUIStateProvider } from "@alga-psa/ui/ui-reflection/ClientUIStateProvider";
import type { Session } from "next-auth";

interface Props {
  children: React.ReactNode;
  session: Session | null;
  initialSidebarCollapsed: boolean;
}

export function MspLayoutClient({ children, session, initialSidebarCollapsed }: Props) {
  return (
    <AppSessionProvider session={session}>
      <TenantProvider>
        <ClientUIStateProvider
          initialPageState={{ id: 'ee-msp', title: 'EE MSP', components: [] }}
        >
          <DefaultLayout initialSidebarCollapsed={initialSidebarCollapsed}>
            {children}
          </DefaultLayout>
        </ClientUIStateProvider>
      </TenantProvider>
    </AppSessionProvider>
  );
}
