import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listClientsMock = vi.fn();
const listContactsMock = vi.fn();
// Stable identity across renders, as in production; the lookup effect depends on it.
const translate = (k: string) => k;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../api/clients", () => ({ listClients: (...args: unknown[]) => listClientsMock(...args) }));
vi.mock("../../../api/contacts", () => ({ listContacts: (...args: unknown[]) => listContactsMock(...args) }));
vi.mock("../../../ui/components/EntityPickerModal", () => ({
  EntityPickerModal: (props: Record<string, unknown>) => React.createElement("MockPicker", props),
}));
vi.mock("../../opportunities/components/LogInteractionModal", () => ({
  LogInteractionModal: (props: Record<string, unknown>) => React.createElement("MockLogModal", props),
}));

import { LogInteractionEntry } from "./LogInteractionEntry";

function render(props: Partial<React.ComponentProps<typeof LogInteractionEntry>> = {}) {
  let renderer!: ReactTestRenderer;
  const onClose = vi.fn();
  const onLogged = vi.fn();
  act(() => {
    renderer = create(React.createElement(LogInteractionEntry, {
      visible: true,
      client: { request: vi.fn() } as never,
      apiKey: "key",
      userId: "user-1",
      onClose,
      onLogged,
      ...props,
    }));
  });
  return { renderer, onClose, onLogged };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const picker = (renderer: ReactTestRenderer) => renderer.root.find((n) => String(n.type) === "MockPicker");
const modal = (renderer: ReactTestRenderer) => renderer.root.find((n) => String(n.type) === "MockLogModal");
const choose = (renderer: ReactTestRenderer, label: string) =>
  act(() => renderer.root.find((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === "function").props.onPress());

describe("LogInteractionEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listContactsMock.mockResolvedValue({ ok: true, data: { data: [
      { contact_name_id: "p-1", full_name: "Jane Doe", client_name: "Acme", email: "jane@acme.com" },
      { contact_name_id: "p-2", full_name: "Sam Roe", client_name: null, email: "sam@x.test" },
    ] } });
    listClientsMock.mockResolvedValue({ ok: true, data: { data: [{ client_id: "c-1", client_name: "Acme", email: "info@acme.com" }] } });
  });

  it("asks who the interaction is with before showing the log dialog", () => {
    const { renderer } = render();
    expect(picker(renderer).props.visible).toBe(false);
    expect(modal(renderer).props.visible).toBe(false);
  });

  it("lists contacts (with their client) and logs against the chosen one", async () => {
    const { renderer, onLogged } = render();

    choose(renderer, "logFor.contact");
    await flush();

    expect(listContactsMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: "key", page: 1, limit: 25, search: undefined }));
    expect(picker(renderer).props).toMatchObject({ visible: true, title: "logFor.pickContact", loading: false, error: null });
    expect(picker(renderer).props.items).toEqual([
      { id: "p-1", label: "Jane Doe", subtitle: "Acme" },
      { id: "p-2", label: "Sam Roe", subtitle: "sam@x.test" },
    ]);

    act(() => picker(renderer).props.onSearch("ja"));
    await flush();
    expect(listContactsMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ search: "ja" }));

    act(() => picker(renderer).props.onSelect("p-1", "Jane Doe"));
    expect(picker(renderer).props.visible).toBe(false);
    expect(modal(renderer).props).toMatchObject({ visible: true, apiKey: "key", userId: "user-1", contactNameId: "p-1", clientId: null });

    act(() => modal(renderer).props.onLogged());
    expect(onLogged).toHaveBeenCalledOnce();
  });

  it("lists clients and logs against the chosen one", async () => {
    const { renderer } = render();

    choose(renderer, "logFor.client");
    await flush();

    expect(listClientsMock).toHaveBeenCalledOnce();
    expect(picker(renderer).props).toMatchObject({ visible: true, title: "logFor.pickClient" });
    expect(picker(renderer).props.items).toEqual([{ id: "c-1", label: "Acme", subtitle: "info@acme.com" }]);

    act(() => picker(renderer).props.onSelect("c-1", "Acme"));
    expect(modal(renderer).props).toMatchObject({ visible: true, clientId: "c-1", contactNameId: null });
  });

  it("surfaces a failed lookup in the picker", async () => {
    listContactsMock.mockResolvedValue({ ok: false, status: 500, error: { kind: "server", message: "boom" } });
    const { renderer } = render();

    choose(renderer, "logFor.contact");
    await flush();

    expect(picker(renderer).props).toMatchObject({ visible: true, error: "logFor.loadFailed", items: [] });
  });

  it("starts over each time it is reopened", async () => {
    const { renderer } = render();
    choose(renderer, "logFor.contact");
    await flush();
    act(() => picker(renderer).props.onSelect("p-1", "Jane Doe"));
    expect(modal(renderer).props.visible).toBe(true);

    act(() => renderer.update(React.createElement(LogInteractionEntry, { visible: false, client: { request: vi.fn() } as never, apiKey: "key", onClose: vi.fn(), onLogged: vi.fn() })));
    act(() => renderer.update(React.createElement(LogInteractionEntry, { visible: true, client: { request: vi.fn() } as never, apiKey: "key", onClose: vi.fn(), onLogged: vi.fn() })));

    expect(modal(renderer).props.visible).toBe(false);
    expect(picker(renderer).props.visible).toBe(false);
  });
});
