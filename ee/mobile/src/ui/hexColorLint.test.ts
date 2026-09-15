import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEX_COLOR_ALLOW_LIST } from "../../eslint.config.mjs";

const projectRoot = path.resolve(__dirname, "../..");
const SAMPLE = 'export const style = { color: "#ff0000" };\n';

async function lint(filePath: string) {
  const mod = await import("eslint/use-at-your-own-risk");
  const { FlatESLint } = (mod as any).default ?? mod;
  const eslint = new FlatESLint({ cwd: projectRoot });
  const [result] = await eslint.lintText(SAMPLE, { filePath });
  return result.messages.map((message: { ruleId: string }) => message.ruleId);
}

describe("hex colour lint rule", () => {
  it("T049 fails on a hex literal added to a component file", async () => {
    await expect(lint("src/features/ticketDetail/components/Probe.tsx")).resolves.toContain(
      "no-restricted-syntax",
    );
  });

  it("T049 allows the palette files on the allow-list", async () => {
    for (const allowed of HEX_COLOR_ALLOW_LIST) {
      await expect(lint(allowed), allowed).resolves.not.toContain("no-restricted-syntax");
    }
  });

  it("T049 keeps the allow-listed files present in the tree", () => {
    for (const allowed of HEX_COLOR_ALLOW_LIST) {
      expect(fs.existsSync(path.join(projectRoot, allowed)), allowed).toBe(true);
    }
  });

  it("T048 leaves no hex literals in the swept components", () => {
    const swept = [
      "src/features/ticketDetail/components/DocumentsSection.tsx",
      "src/features/inventory/components/ScanView.tsx",
      "src/screens/SignInScreen.tsx",
      "src/features/ticketRichText/MentionSuggestionList.tsx",
      "src/features/ticketDetail/components/MaterialsSection.tsx",
    ];
    for (const file of swept) {
      const contents = fs.readFileSync(path.join(projectRoot, file), "utf8");
      expect(contents.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], file).toEqual([]);
    }
  });

  it("T047 keeps the preview scrim black while its controls follow the theme", () => {
    const documents = fs.readFileSync(
      path.join(projectRoot, "src/features/ticketDetail/components/DocumentsSection.tsx"),
      "utf8",
    );
    expect(documents).toContain('backgroundColor: "rgba(0,0,0,0.9)"');
    expect(documents).toContain("color={colors.overlayText}");
  });
});
