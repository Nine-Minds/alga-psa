/**
 * The colours the comment editor web view needs, as CSS variables.
 *
 * The web view ships with light defaults baked into the generated HTML; the app
 * overrides them from the active theme — once in a <style> tag so the first
 * paint is already correct, then through the `set-theme` bridge message
 * whenever the tenant pair or the light/dark preference changes.
 *
 * Imported by both the app and scripts/ticket-mobile-editor-browser-entry.ts.
 */

export type TicketMobileEditorThemePayload = {
  mode: "light" | "dark";
  background: string;
  text: string;
  textSecondary: string;
  link: string;
  mentionBackground: string;
  mentionText: string;
};

export const EDITOR_THEME_VARIABLES: Record<
  Exclude<keyof TicketMobileEditorThemePayload, "mode">,
  string
> = {
  background: "--editor-bg",
  text: "--editor-text",
  textSecondary: "--editor-text-secondary",
  link: "--editor-link",
  mentionBackground: "--editor-mention-bg",
  mentionText: "--editor-mention-text",
};

type StyleTarget = { style: { setProperty: (property: string, value: string) => void } };

/** Runs inside the web view: pushes a payload onto the document root. */
export function applyEditorTheme(root: StyleTarget, payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const values = payload as Record<string, unknown>;

  for (const [key, variable] of Object.entries(EDITOR_THEME_VARIABLES)) {
    const value = values[key];
    if (typeof value === "string" && value.length > 0) {
      root.style.setProperty(variable, value);
    }
  }

  if (values.mode === "light" || values.mode === "dark") {
    root.style.setProperty("color-scheme", values.mode);
  }
}

/** The same payload as a `:root` block, for the pre-load <style> injection. */
export function editorThemeCss(payload: TicketMobileEditorThemePayload): string {
  const declarations = Object.entries(EDITOR_THEME_VARIABLES)
    .map(([key, variable]) => `${variable}: ${payload[key as keyof TicketMobileEditorThemePayload]};`)
    .join(" ");
  return `:root { color-scheme: ${payload.mode}; ${declarations} }`;
}
