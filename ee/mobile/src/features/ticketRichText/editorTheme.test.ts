import { describe, expect, it, vi } from "vitest";
import {
  applyEditorTheme,
  editorThemeCss,
  EDITOR_THEME_VARIABLES,
  type TicketMobileEditorThemePayload,
} from "./editorTheme";
import { TICKET_MOBILE_EDITOR_HTML } from "./generatedEditorHtml";

const payload: TicketMobileEditorThemePayload = {
  mode: "dark",
  background: "#121f17",
  text: "#e4f2e8",
  textSecondary: "#93ab9b",
  link: "#16a34a",
  mentionBackground: "#263468",
  mentionText: "#b1cdfb",
};

function fakeRoot() {
  const properties: Record<string, string> = {};
  return {
    properties,
    style: { setProperty: vi.fn((key: string, value: string) => { properties[key] = value; }) },
  };
}

describe("editor theme", () => {
  it("T050 declares the six CSS variables with light defaults in the generated HTML", () => {
    for (const variable of Object.values(EDITOR_THEME_VARIABLES)) {
      expect(TICKET_MOBILE_EDITOR_HTML, variable).toContain(`${variable}: #`);
      expect(TICKET_MOBILE_EDITOR_HTML, variable).toContain(`var(${variable})`);
    }
    // The mention badge reads its colours from the variables, not a literal.
    expect(TICKET_MOBILE_EDITOR_HTML).toContain("background-color: var(--editor-mention-bg)");
    expect(TICKET_MOBILE_EDITOR_HTML).toContain("color: var(--editor-mention-text)");
  });

  it("T051 applies a payload onto the document root", () => {
    const root = fakeRoot();
    applyEditorTheme(root, payload);

    expect(root.properties).toEqual({
      "--editor-bg": payload.background,
      "--editor-text": payload.text,
      "--editor-text-secondary": payload.textSecondary,
      "--editor-link": payload.link,
      "--editor-mention-bg": payload.mentionBackground,
      "--editor-mention-text": payload.mentionText,
      "color-scheme": "dark",
    });
  });

  it("T051 ignores junk payloads instead of throwing", () => {
    const root = fakeRoot();
    applyEditorTheme(root, null);
    applyEditorTheme(root, "dark");
    applyEditorTheme(root, { background: 42, mode: "neon" });

    expect(root.style.setProperty).not.toHaveBeenCalled();
  });

  it("T051 renders the same payload as a :root block for the first paint", () => {
    expect(editorThemeCss(payload)).toBe(
      ":root { color-scheme: dark; --editor-bg: #121f17; --editor-text: #e4f2e8;"
      + " --editor-text-secondary: #93ab9b; --editor-link: #16a34a;"
      + " --editor-mention-bg: #263468; --editor-mention-text: #b1cdfb; }",
    );
  });
});
