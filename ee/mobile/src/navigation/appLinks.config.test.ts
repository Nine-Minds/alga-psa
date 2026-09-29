import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

type AppJson = {
  expo: {
    scheme?: string;
    ios?: { associatedDomains?: string[] };
    android?: {
      intentFilters?: Array<{
        action?: string;
        autoVerify?: boolean;
        data?: Array<{ scheme?: string; host?: string; pathPrefix?: string }>;
        category?: string[];
      }>;
    };
  };
};

// The hosted ticket link handling in linking.ts only fires if the OS hands
// the URL to the app, which these app.json declarations control.
describe("hosted app link declarations", () => {
  it("claims https://algapsa.com/msp/tickets/ on both platforms", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const appJson = JSON.parse(await readFile(path.join(root, "app.json"), "utf8")) as AppJson;

    expect(appJson.expo.scheme).toBe("alga");
    expect(appJson.expo.ios?.associatedDomains).toEqual(["applinks:algapsa.com"]);

    const filter = appJson.expo.android?.intentFilters?.find((f) =>
      f.data?.some((d) => d.host === "algapsa.com"),
    );
    expect(filter).toBeDefined();
    expect(filter?.action).toBe("VIEW");
    expect(filter?.autoVerify).toBe(true);
    expect(filter?.category).toEqual(expect.arrayContaining(["BROWSABLE", "DEFAULT"]));
    expect(filter?.data).toEqual([{ scheme: "https", host: "algapsa.com", pathPrefix: "/msp/tickets/" }]);
  });
});
