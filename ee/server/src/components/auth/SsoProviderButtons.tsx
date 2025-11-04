"use client";

import clsx from "clsx";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "server/src/components/ui/Button";
import { Alert, AlertDescription } from "server/src/components/ui/Alert";
import { Badge } from "server/src/components/ui/Badge";
import { LogIn, Network } from "lucide-react";
import type { SsoProviderOption } from "@ee/lib/auth/providerConfig";
import { getSsoProviderOptionsAction } from "@ee/lib/actions/auth/getSsoProviderOptions";

interface SsoProviderButtonsProps {
  callbackUrl: string;
  tenantHint?: string;
  linkedProviders?: string[];
}

export default function SsoProviderButtons({
  callbackUrl,
  tenantHint,
  linkedProviders = [],
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

  return (
    <div className="space-y-4">
      {linkedProviders.length > 0 && (
        <Alert>
          <AlertDescription className="flex items-center gap-2">
            <LogIn className="h-4 w-4" />
            <span>
              Single sign-on is enabled for this account. Use one of the providers below to skip local password and two-factor prompts.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {configuredOptions.map((provider) => {
          const isLinked = linkedProviders.includes(provider.id);
          const isPending = pendingProvider === provider.id;

          return (
            <div
              key={provider.id}
              className={clsx(
                "flex flex-col justify-between rounded-md border p-4",
                isLinked ? "border-primary/70" : "border-muted"
              )}
            >
              <div className="flex items-start gap-3">
                <Network className="h-5 w-5 text-primary" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{provider.name}</span>
                    {isLinked && <Badge variant="secondary">Linked</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{provider.description}</p>
                </div>
              </div>
              <Button
                type="button"
                className="mt-4"
                onClick={() => handleSignIn(provider.id)}
                disabled={isPending}
              >
                {isPending ? "Redirecting..." : `Sign in with ${provider.name}`}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
