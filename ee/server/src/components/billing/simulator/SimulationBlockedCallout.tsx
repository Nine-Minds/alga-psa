"use client";

import React from "react";
import type { SimulationDiagnostic } from "@alga-psa/types";
import { Alert, AlertDescription, AlertTitle } from "@alga-psa/ui/components/Alert";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";

const NAMESPACE_PREFIX = "msp/contracts:";

/**
 * The localized sentence for a blocking diagnostic. `message_key` is a
 * namespaced key (`msp/contracts:contractSimulator.errors.…`); the English
 * `message` is the fallback if a locale lacks it.
 */
export function useBlockingDiagnosticMessage(): (
  diagnostic: SimulationDiagnostic,
) => string {
  const { t } = useTranslation("msp/contracts");
  return (diagnostic) => {
    if (!diagnostic.message_key) return diagnostic.message;
    const key = diagnostic.message_key.startsWith(NAMESPACE_PREFIX)
      ? diagnostic.message_key.slice(NAMESPACE_PREFIX.length)
      : diagnostic.message_key;
    return t(key, {
      defaultValue: diagnostic.message,
      ...(diagnostic.message_params ?? {}),
    });
  };
}

/**
 * Where the totals would have been when the simulator refused to run. It shows
 * what to fix (the message names the contract line, the service and its
 * configuration type) and nothing priced.
 */
export function SimulationBlockedCallout({
  diagnostics,
  title,
  onFocusLine,
}: {
  diagnostics: SimulationDiagnostic[];
  /** Overrides the default heading, e.g. when only the comparison side is blocked. */
  title?: string;
  onFocusLine?: (lineKey: string) => void;
}) {
  const { t } = useTranslation("msp/contracts");
  const describe = useBlockingDiagnosticMessage();
  return (
    <Alert variant="destructive" id="simulation-blocked-callout">
      <AlertTitle>
        {title ??
          t("contractSimulator.errors.title", {
            defaultValue: "The simulation can't run",
          })}
      </AlertTitle>
      <AlertDescription>
        <ul className="space-y-1">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code ?? "error"}-${index}`}>
              {diagnostic.line_key && onFocusLine ? (
                <button
                  type="button"
                  className="text-left underline decoration-dotted underline-offset-2"
                  onClick={() => onFocusLine(diagnostic.line_key!)}
                >
                  {describe(diagnostic)}
                </button>
              ) : (
                describe(diagnostic)
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
