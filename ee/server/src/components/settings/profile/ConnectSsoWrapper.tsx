"use client";

import { useEffect, useState, useRef } from "react";
import ConnectSsoClient from "./ConnectSsoClient";
import { getSsoProviderOptionsAction } from "@ee/lib/actions/auth/getSsoProviderOptions";
import { getLinkedSsoAccountsAction, type LinkedSsoAccount } from "@ee/lib/actions/auth/ssoPreferences";
import Spinner from "@alga-psa/ui/components/Spinner";

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  configured: boolean;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "An unexpected error occurred while loading SSO settings";
}

export default function ConnectSsoWrapper() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedSsoAccount[]>([]);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    async function loadSsoData() {
      try {
        setLoading(true);
        setError(null);

        const [providersResult, accountsResult] = await Promise.all([
          getSsoProviderOptionsAction(),
          getLinkedSsoAccountsAction(),
        ]);

        // Prevent setState on unmounted component
        if (!isMountedRef.current) {
          return;
        }

        if (!accountsResult.success) {
          setError(accountsResult.error ?? "Unable to load your linked SSO accounts. Please try again.");
          return;
        }

        // Map SsoProviderOption to ProviderOption format
        const options = providersResult.options ?? [];
        const mappedProviders: ProviderOption[] = options.map((opt) => ({
          id: opt.id,
          name: opt.name,
          description: opt.description ?? "",
          configured: opt.configured,
        }));

        setProviderOptions(mappedProviders);
        setLinkedAccounts(accountsResult.accounts ?? []);
        setEmail(accountsResult.email ?? "");
        setTwoFactorEnabled(accountsResult.twoFactorEnabled ?? false);
      } catch (err: unknown) {
        if (!isMountedRef.current) {
          return;
        }
        setError(getErrorMessage(err));
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }

    loadSsoData();

    return () => {
      isMountedRef.current = false;
    };
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
