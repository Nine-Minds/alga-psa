"use client";
import React from "react";
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

type Props = React.ComponentProps<typeof NextAuthSessionProvider>;

export function AppSessionProvider({ children, ...rest }: Props) {
  return (
    <NextAuthSessionProvider refetchOnWindowFocus={false} {...rest}>
      {children}
    </NextAuthSessionProvider>
  );
}
