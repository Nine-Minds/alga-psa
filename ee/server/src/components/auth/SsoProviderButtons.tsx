"use client";

import clsx from "clsx";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "@alga-psa/ui/components/Button";
import { Loader2 } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import type { SsoProviderOption } from "@ee/lib/auth/providerConfig";
import { getSsoProviderOptionsAction } from "@ee/lib/actions/auth/getSsoProviderOptions";

const MicrosoftMulticolorLogo = () => (
  <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="8" height="8" fill="#F25022" />
    <rect x="14" y="2" width="8" height="8" fill="#7FBA00" />
    <rect x="2" y="14" width="8" height="8" fill="#00A4EF" />
    <rect x="14" y="14" width="8" height="8" fill="#FFB900" />
  </svg>
);

interface SsoProviderButtonsProps {
  callbackUrl: string;
  tenantHint?: string;
}

export default function SsoProviderButtons({
  callbackUrl,
  tenantHint,
}: SsoProviderButtonsProps) {
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [providerOptions, setProviderOptions] = useState<SsoProviderOption[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadOptions = async () => {
      try {
        const result = await getSsoProviderOptionsAction();
        if (!cancelled && result.options) {
          setProviderOptions(result.options);
        }
      } catch (error) {
        if (!cancelled) {
          setProviderOptions([]);
        }
      }
    };

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  const configuredOptions = providerOptions.filter((option) => option.configured);

  if (configuredOptions.length === 0) {
    return null;
  }

  const handleSignIn = async (providerId: string) => {
    setPendingProvider(providerId);
    try {
      const statePayload: Record<string, unknown> = {
        mode: "login",
        tenant: tenantHint ?? null,
      };

      const authorizationParams: Record<string, string> = {
        state: JSON.stringify(statePayload),
      };

      if (tenantHint) {
        authorizationParams.tenant_hint = tenantHint;
      }

      await signIn(providerId, { callbackUrl }, authorizationParams);
    } finally {
      setPendingProvider(null);
    }
  };

  const getProviderIcon = (providerId: string) => {
    if (providerId === "google") {
      return <SiGoogle className="h-8 w-8" style={{ color: "#34A853" }} aria-hidden />;
    }
    if (providerId === "azure-ad") {
      return <MicrosoftMulticolorLogo />;
    }
    return null;
  };

  return (
    <div className="flex gap-3">
      {configuredOptions.map((provider) => {
        const isPending = pendingProvider === provider.id;

        return (
          <Button
            key={provider.id}
            id={`sso-provider-${provider.id}-button`}
            type="button"
            variant="outline"
            size="lg"
            onClick={() => handleSignIn(provider.id)}
            disabled={isPending}
            className={clsx(
              "flex items-center gap-2 px-6 py-2 h-auto",
              provider.id === "google" && "border-[#34A853] hover:bg-[#34A853]/5",
              provider.id === "azure-ad" && "border-[#0078D4] hover:bg-[#0078D4]/5"
            )}
          >
            {isPending ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              getProviderIcon(provider.id)
            )}
            {isPending ? "Redirecting..." : `${provider.name}`}
          </Button>
        );
      })}
    </div>
  );
}
