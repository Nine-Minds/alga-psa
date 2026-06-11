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
            index: 5,
            routes: [
              { name: "TicketsTab" },
              { name: "ScheduleTab" },
              { name: "TimeEntriesTab" },
              { name: "ClientsTab" },
              { name: "ContactsTab" },
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

  it("resolves drawer routes nested under the root stack", () => {
    const state = {
      index: 0,
      routes: [
        {
          name: "Tabs",
          state: {
            index: 0,
            routes: [
              {
                name: "TicketsTab",
                state: {
                  index: 0,
                  routes: [{ name: "TicketsList" }],
                },
              },
              { name: "ClientsTab" },
            ],
          },
        },
      ],
    };

    expect(getActiveRouteName(state)).toBe("TicketsList");
  });
});

