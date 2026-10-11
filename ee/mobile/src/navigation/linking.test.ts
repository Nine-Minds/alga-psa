import { describe, expect, it, vi } from "vitest";

vi.mock("expo-linking", () => {
  return {
    createURL: (path: string) => `exp://test/${path}`,
    parse: (rawUrl: string) => {
      const u = new URL(rawUrl);
      return {
        scheme: u.protocol.replace(":", ""),
        hostname: u.hostname,
        path: u.pathname.replace(/^\//, ""),
      };
    },
    getInitialURL: vi.fn(async () => null),
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  };
});

describe("navigation deep link config", () => {
  it("declares alga:// deep link routing for ticket detail", async () => {
    const mod = await import("./linking");
    const linking = mod.linking as any;

    expect(linking.prefixes).toContain("alga://");
    expect(linking.config.screens.TicketDetail).toBe("ticket/:ticketId");
    expect(linking.config.screens.SignIn).toBe("signin");
  });

  it("maps drawer routes to deep link paths", async () => {
    const mod = await import("./linking");
    const linking = mod.linking as any;
    const drawerScreens = linking.config.screens.Tabs.screens;

    expect(drawerScreens.TicketsTab.screens.TicketsList).toBe("tickets");
    expect(drawerScreens.ScheduleTab).toBe("schedule");
    expect(drawerScreens.TimeEntriesTab).toBe("time-entries");
    expect(drawerScreens.ClientsTab).toBe("clients");
    expect(drawerScreens.ContactsTab).toBe("contacts");
    expect(drawerScreens.SettingsTab).toBe("settings");
  });
});

describe("hosted ticket links", () => {
  it("folds a hosted web ticket URL into the alga:// ticket route", async () => {
    const { normalizeHostedTicketUrl } = await import("./linking");
    const id = "541B5B63-9E14-47B6-A8F0-0B664F079ED4";
    expect(normalizeHostedTicketUrl(`https://algapsa.com/msp/tickets/${id}`)).toBe(
      `alga://ticket/${id.toLowerCase()}`,
    );
    expect(normalizeHostedTicketUrl(`https://algapsa.com/msp/tickets/${id}#comment-abc`)).toBe(
      `alga://ticket/${id.toLowerCase()}`,
    );
    expect(normalizeHostedTicketUrl(`https://algapsa.com/msp/tickets/${id}?tab=time`)).toBe(
      `alga://ticket/${id.toLowerCase()}`,
    );
  });

  it("leaves every other hosted URL alone", async () => {
    const { normalizeHostedTicketUrl } = await import("./linking");
    for (const url of [
      "https://algapsa.com/msp/tickets",
      "https://algapsa.com/msp/clients/541b5b63-9e14-47b6-a8f0-0b664f079ed4",
      "https://evil.com/msp/tickets/541b5b63-9e14-47b6-a8f0-0b664f079ed4",
      "https://algapsa.com.evil.com/msp/tickets/541b5b63-9e14-47b6-a8f0-0b664f079ed4",
      "http://algapsa.com/msp/tickets/541b5b63-9e14-47b6-a8f0-0b664f079ed4",
    ]) {
      expect(normalizeHostedTicketUrl(url)).toBe(url);
    }
  });

  it("opens a hosted ticket link directly when signed in", async () => {
    const ExpoLinking = await import("expo-linking");
    const url = "https://algapsa.com/msp/tickets/541b5b63-9e14-47b6-a8f0-0b664f079ed4";
    (ExpoLinking.getInitialURL as any).mockResolvedValueOnce(url);
    vi.resetModules();
    const { linking, setDeepLinkSignedIn } = await import("./linking");
    setDeepLinkSignedIn(true);
    await expect(linking.getInitialURL?.()).resolves.toBe("alga://ticket/541b5b63-9e14-47b6-a8f0-0b664f079ed4");
  });

  it("holds a ticket link tapped while signed out and replays it once after sign-in", async () => {
    const ExpoLinking = await import("expo-linking");
    const url = "https://algapsa.com/msp/tickets/541b5b63-9e14-47b6-a8f0-0b664f079ed4";
    (ExpoLinking.getInitialURL as any).mockResolvedValue(url);
    vi.resetModules();
    const { linking, setDeepLinkSignedIn } = await import("./linking");

    setDeepLinkSignedIn(false);
    await expect(linking.getInitialURL?.()).resolves.toBeNull();

    setDeepLinkSignedIn(true);
    await expect(linking.getInitialURL?.()).resolves.toBe("alga://ticket/541b5b63-9e14-47b6-a8f0-0b664f079ed4");
    // A later remount (sign out / in) must not send the user back to the ticket.
    await expect(linking.getInitialURL?.()).resolves.toBeNull();
    (ExpoLinking.getInitialURL as any).mockReset();
    (ExpoLinking.getInitialURL as any).mockResolvedValue(null);
  });

  it("holds a warm ticket link while signed out instead of dropping it", async () => {
    const ExpoLinking = await import("expo-linking");
    let handler: ((e: { url: string }) => void) | null = null;
    (ExpoLinking.addEventListener as any).mockImplementationOnce((_: string, cb: (e: { url: string }) => void) => {
      handler = cb;
      return { remove: vi.fn() };
    });
    vi.resetModules();
    const { linking, setDeepLinkSignedIn } = await import("./linking");
    const listener = vi.fn();
    setDeepLinkSignedIn(false);
    linking.subscribe?.(listener);
    handler!({ url: "alga://ticket/541b5b63-9e14-47b6-a8f0-0b664f079ed4" });
    expect(listener).not.toHaveBeenCalled();

    setDeepLinkSignedIn(true);
    await expect(linking.getInitialURL?.()).resolves.toBe("alga://ticket/541b5b63-9e14-47b6-a8f0-0b664f079ed4");
  });

  it("does not hold non-ticket links for sign-in", async () => {
    const ExpoLinking = await import("expo-linking");
    (ExpoLinking.getInitialURL as any).mockResolvedValueOnce("alga://signin");
    vi.resetModules();
    const { linking, setDeepLinkSignedIn } = await import("./linking");
    setDeepLinkSignedIn(false);
    await expect(linking.getInitialURL?.()).resolves.toBe("alga://signin");
  });

  it("reports a cold-start ticket link as pending so restored nav state does not override it", async () => {
    const ExpoLinking = await import("expo-linking");
    const url = "https://algapsa.com/msp/tickets/541b5b63-9e14-47b6-a8f0-0b664f079ed4";
    (ExpoLinking.getInitialURL as any).mockResolvedValue(url);
    vi.resetModules();
    const { linking, hasPendingDeepLink, setDeepLinkSignedIn } = await import("./linking");
    setDeepLinkSignedIn(true);

    await expect(hasPendingDeepLink()).resolves.toBe(true);
    await expect(linking.getInitialURL?.()).resolves.toBe("alga://ticket/541b5b63-9e14-47b6-a8f0-0b664f079ed4");
    // Once followed, later remounts restore the saved screen again.
    await expect(hasPendingDeepLink()).resolves.toBe(false);
    (ExpoLinking.getInitialURL as any).mockReset();
    (ExpoLinking.getInitialURL as any).mockResolvedValue(null);
  });

  it("reports a ticket link held during sign-in as pending", async () => {
    const ExpoLinking = await import("expo-linking");
    const url = "https://algapsa.com/msp/tickets/541b5b63-9e14-47b6-a8f0-0b664f079ed4";
    (ExpoLinking.getInitialURL as any).mockResolvedValue(url);
    vi.resetModules();
    const { linking, hasPendingDeepLink, setDeepLinkSignedIn } = await import("./linking");
    setDeepLinkSignedIn(false);
    await expect(linking.getInitialURL?.()).resolves.toBeNull();

    setDeepLinkSignedIn(true);
    await expect(hasPendingDeepLink()).resolves.toBe(true);
    (ExpoLinking.getInitialURL as any).mockReset();
    (ExpoLinking.getInitialURL as any).mockResolvedValue(null);
  });

  it("does not report rejected or absent links as pending", async () => {
    const ExpoLinking = await import("expo-linking");
    vi.resetModules();
    const { hasPendingDeepLink } = await import("./linking");
    (ExpoLinking.getInitialURL as any).mockResolvedValueOnce(null);
    await expect(hasPendingDeepLink()).resolves.toBe(false);
    (ExpoLinking.getInitialURL as any).mockResolvedValueOnce("https://algapsa.com/msp/clients/541b5b63-9e14-47b6-a8f0-0b664f079ed4");
    await expect(hasPendingDeepLink()).resolves.toBe(false);
  });

  it("routes project-task deep links to the task screen and folds hosted project task URLs", async () => {
    const mod = await import("./linking");
    const linking = mod.linking as any;
    expect(linking.config.screens.ProjectTaskDetail).toBe("project-task/:taskId");
    expect(mod.normalizeHostedTicketUrl("https://algapsa.com/msp/projects/11111111-1111-4111-8111-111111111111?phaseId=x&taskId=22222222-2222-4222-8222-222222222222"))
      .toBe("alga://project-task/22222222-2222-4222-8222-222222222222");
    expect(mod.normalizeHostedTicketUrl("https://algapsa.com/msp/projects/11111111-1111-4111-8111-111111111111")).toBe("https://algapsa.com/msp/projects/11111111-1111-4111-8111-111111111111");
  });

  it("holds a task link tapped while signed out like a ticket link", async () => {
    const mod = await import("./linking");
    const expoLinking = await import("expo-linking");
    mod.setDeepLinkSignedIn(false);
    const listener = vi.fn();
    const addEventListener = expoLinking.addEventListener as unknown as ReturnType<typeof vi.fn>;
    addEventListener.mockImplementation((_event: string, handler: (event: { url: string }) => void) => {
      handler({ url: "alga://project-task/22222222-2222-4222-8222-222222222222" });
      return { remove: vi.fn() };
    });
    mod.linking.subscribe!(listener);
    expect(listener).not.toHaveBeenCalled();
    mod.setDeepLinkSignedIn(true);
    await expect(mod.linking.getInitialURL!()).resolves.toBe("alga://project-task/22222222-2222-4222-8222-222222222222");
  });
});
