import { describe, expect, it, vi } from "vitest";

const getInteraction = vi.fn();
const getTicketById = vi.fn();
const getClient = vi.fn();
const getContact = vi.fn();
vi.mock("../../../api/interactions", () => ({ getInteraction: (...a: unknown[]) => getInteraction(...a) }));
vi.mock("../../../api/tickets", () => ({ getTicketById: (...a: unknown[]) => getTicketById(...a) }));
vi.mock("../../../api/clients", () => ({ getClient: (...a: unknown[]) => getClient(...a) }));
vi.mock("../../../api/contacts", () => ({ getContact: (...a: unknown[]) => getContact(...a) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("../../../ui/ThemeContext", () => ({ useTheme: () => ({ colors: {}, spacing: {}, typography: {} }) }));

import { loadInteractionEntryLinks } from "./InteractionEntryContext";

const client = { request: vi.fn() } as never;

describe("loadInteractionEntryLinks", () => {
  it("resolves the ticket, client, and contact behind an interaction entry", async () => {
    getInteraction.mockResolvedValue({ ok: true, data: { data: { interaction_id: "i-1", ticket_id: "t-1", client_id: "c-1", contact_name_id: "p-1", notes: "Ask about backup" } } });
    getTicketById.mockResolvedValue({ ok: true, data: { data: { ticket_id: "t-1", ticket_number: "1042", title: "Backup failing" } } });
    getClient.mockResolvedValue({ ok: true, data: { data: { client_id: "c-1", client_name: "Acme", phone_no: "555-0100" } } });
    getContact.mockResolvedValue({ ok: true, data: { data: { contact_name_id: "p-1", full_name: "Sam Lee", default_phone_number: "555-0199", email: "sam@acme.test" } } });

    const links = await loadInteractionEntryLinks(client, "key", "i-1");

    expect(getTicketById).toHaveBeenCalledWith(client, { apiKey: "key", ticketId: "t-1" });
    expect(links?.ticket?.ticket_number).toBe("1042");
    expect(links?.client?.client_name).toBe("Acme");
    expect(links?.contact?.default_phone_number).toBe("555-0199");
    expect(links?.interaction.notes).toBe("Ask about backup");
  });

  it("tolerates an interaction with no linked records and a failed lookup", async () => {
    getInteraction.mockResolvedValue({ ok: true, data: { data: { interaction_id: "i-2", ticket_id: null, client_id: "c-1", contact_name_id: null } } });
    getClient.mockResolvedValue({ ok: false, error: { kind: "network" } });

    const links = await loadInteractionEntryLinks(client, "key", "i-2");
    expect(links).toEqual({ interaction: expect.objectContaining({ interaction_id: "i-2" }), ticket: null, client: null, contact: null });
    expect(getTicketById).not.toHaveBeenCalledWith(client, expect.objectContaining({ ticketId: null }));

    getInteraction.mockResolvedValue({ ok: false, error: { kind: "notFound" } });
    expect(await loadInteractionEntryLinks(client, "key", "gone")).toBeNull();
  });
});
