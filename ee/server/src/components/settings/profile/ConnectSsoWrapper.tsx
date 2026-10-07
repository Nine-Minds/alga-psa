"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ConnectSsoClient from "./ConnectSsoClient";
import { getSsoProviderOptionsAction } from "@ee/lib/actions/auth/getSsoProviderOptions";
import { getLinkedSsoAccountsAction, type LinkedSsoAccount } from "@ee/lib/actions/auth/ssoPreferences";
import Spinner from "@alga-psa/ui/components/Spinner";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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

const SSO_TAB_URL = "/msp/profile?tab=Single%20Sign-On";

export default function ConnectSsoWrapper() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedSsoAccount[]>([]);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const isMountedRef = useRef(true);
  // Captured once: the params are stripped below so a refresh does not replay
  // a stale outcome from a previous link attempt.
  const [linkOutcome] = useState(() => ({
    linked: searchParams?.get("linked") === "1",
    linkError: searchParams?.get("linkError") ?? undefined,
    providerEmail: searchParams?.get("providerEmail") ?? undefined,
  }));

  useEffect(() => {
    if (linkOutcome.linked || linkOutcome.linkError) {
      router.replace(SSO_TAB_URL);
    }
  }, [linkOutcome, router]);

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
        <p className="mt-4 text-sm text-muted-foreground">{t('pages.loading.ssoSettings', { defaultValue: 'Loading SSO settings...' })}</p>
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
      linkStatus={linkOutcome.linkError ? "error" : linkOutcome.linked ? "linked" : undefined}
      linkErrorCode={linkOutcome.linkError}
      linkErrorProviderEmail={linkOutcome.providerEmail}
    />
  );
}
