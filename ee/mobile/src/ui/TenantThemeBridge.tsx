import { useEffect, useRef } from "react";
import { useTenantTheme } from "./ThemeContext";
import { writeCachedTheme } from "./themeCache";
import type { MobileTheme } from "./themeTokens";

/**
 * Pushes the theme block from capabilities into ThemeContext and caches it.
 *
 * AppRoot nests ThemeProvider above CapabilitiesProvider (the theme has to
 * survive sign-out), so the theme cannot read capabilities directly. This
 * component lives on the capabilities side of that boundary and hands the block
 * upwards.
 */
export function TenantThemeBridge({
  theme,
  baseUrl,
  tenantId,
}: {
  theme: MobileTheme | null;
  baseUrl: string | null;
  tenantId: string | null | undefined;
}) {
  const { setTenantTheme } = useTenantTheme();
  const lastAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    const signature = `${baseUrl ?? ""}|${tenantId ?? ""}|${theme?.version ?? ""}`;
    if (lastAppliedRef.current === signature) return;
    lastAppliedRef.current = signature;

    setTenantTheme(theme);
    if (theme) void writeCachedTheme(baseUrl, tenantId, theme);
  }, [theme, baseUrl, tenantId, setTenantTheme]);

  return null;
}
