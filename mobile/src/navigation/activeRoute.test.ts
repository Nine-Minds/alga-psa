import { describe, expect, it } from "vitest";
import { getActiveRouteName } from "./activeRoute";

describe("getActiveRouteName", () => {
  it("returns the active leaf route name for nested navigation state", () => {
    const state = {
      index: 0,
      routes: [
        {
          name: "Tabs",
          state: {
            index: 1,
            routes: [
              { name: "TicketsTab" },
              { name: "SettingsTab" },
            ],
          },
        },
      ],
    };

    expect(getActiveRouteName(state)).toBe("SettingsTab");
    expect(getActiveRouteName({ index: 0, routes: [{ name: "SignIn" }] })).toBe("SignIn");
    expect(getActiveRouteName({})).toBeNull();
  });
});

