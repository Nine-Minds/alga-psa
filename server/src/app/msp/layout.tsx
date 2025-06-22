"use client";
import { SessionProvider } from "next-auth/react";
import DefaultLayout from "server/src/components/layout/DefaultLayout";
import { TagProvider } from "server/src/context/TagContext";

export default function MspLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SessionProvider>
      <TagProvider>
        <DefaultLayout>
          {children}
        </DefaultLayout>
      </TagProvider>
    </SessionProvider>
  );
}
