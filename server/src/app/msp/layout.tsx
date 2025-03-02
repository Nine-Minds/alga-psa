"use client";
import { SessionProvider } from "next-auth/react";
import DefaultLayout from "@/components/layout/DefaultLayout";

export default function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SessionProvider>
      <DefaultLayout>
        {children}
      </DefaultLayout>
    </SessionProvider>
  );
}
