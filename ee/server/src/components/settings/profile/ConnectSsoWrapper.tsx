"use client";

import { useEffect, useState } from "react";
import ConnectSsoClient from "./ConnectSsoClient";
import { getSsoProviderOptionsAction } from "@ee/lib/actions/auth/getSsoProviderOptions";
import { getLinkedSsoAccountsAction, type LinkedSsoAccount } from "@ee/lib/actions/auth/ssoPreferences";
import Spinner from "server/src/components/ui/Spinner";

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  configured: boolean;
}

export default function ConnectSsoWrapper() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedSsoAccount[]>([]);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);

  useEffect(() => {
    async function loadSsoData() {
      try {
        setLoading(true);
        setError(null);

        const [providersResult, accountsResult] = await Promise.all([
          getSsoProviderOptionsAction(),
          getLinkedSsoAccountsAction(),
        ]);

        if (!accountsResult.success) {
          setError(accountsResult.error ?? "Failed to load linked accounts");
          return;
        }

        // Map SsoProviderOption to ProviderOption format
        const mappedProviders: ProviderOption[] = (providersResult.options ?? []).map((opt) => ({
          id: opt.id,
          name: opt.name,
          description: opt.description ?? "",
          configured: opt.configured,
        }));

        setProviderOptions(mappedProviders);
        setLinkedAccounts(accountsResult.accounts ?? []);
        setEmail(accountsResult.email ?? "");
        setTwoFactorEnabled(accountsResult.twoFactorEnabled ?? false);
      } catch (err: any) {
        setError(err?.message ?? "Failed to load SSO settings");
      } finally {
        setLoading(false);
      }
    }

    loadSsoData();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Spinner size="sm" />
        <p className="mt-4 text-sm text-muted-foreground">Loading SSO settings...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <ConnectSsoClient
      email={email}
      twoFactorEnabled={twoFactorEnabled}
      linkedAccounts={linkedAccounts}
      providerOptions={providerOptions}
    />
  );
}
