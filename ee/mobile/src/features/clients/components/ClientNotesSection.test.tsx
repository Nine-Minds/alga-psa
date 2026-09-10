import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClientNotesMock = vi.fn();
const saveClientNotesMock = vi.fn();

const translate = (key: string) => key;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock("../../../api/clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/clients")>()),
  getClientNotes: (...args: unknown[]) => getClientNotesMock(...args),
  saveClientNotes: (...args: unknown[]) => saveClientNotesMock(...args),
}));

vi.mock("../../../ui/components/Card", () => ({
  Card: (props: Record<string, unknown>) => React.createElement("MockCard", props, props.children as React.ReactNode),
}));
vi.mock("../../../ui/components/SectionHeader", () => ({
  SectionHeader: (props: Record<string, unknown>) =>
    React.createElement("MockSectionHeader", props, React.createElement(Text, null, props.title as string), props.action as React.ReactNode),
}));
vi.mock("../../../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) => React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));
vi.mock("../../../ui/components/TextInput", () => ({
  TextInput: (props: Record<string, unknown>) => React.createElement("MockTextInput", props),
}));

import { ClientNotesSection } from "./ClientNotesSection";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] });

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function render(props: Partial<React.ComponentProps<typeof ClientNotesSection>> = {}): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      React.createElement(ClientNotesSection, {
        client: { request: vi.fn() } as never,
        apiKey: "key",
        clientId: "client-1",
        ...props,
      }),
    );
  });
  if (!renderer) throw new Error("no renderer");
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

describe("ClientNotesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientNotesMock.mockResolvedValue({ ok: true, data: { data: { document: null, blockData: null, lastUpdated: null } } });
    saveClientNotesMock.mockResolvedValue({ ok: true, data: { data: { document_id: "doc-1" } } });
  });

  it("renders the rich-text notes flattened to text plus legacy notes", async () => {
    getClientNotesMock.mockResolvedValue({
      ok: true,
      data: { data: { document: {}, blockData: [paragraph("Gate code 4321"), paragraph("Ask for Sam")], lastUpdated: null } },
    });

    const renderer = render({ legacyNotes: "  Old alarm code 9999  " });
    await flush();

    expect(getClientNotesMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientId: "client-1", apiKey: "key" }));
    expect(renderer.root.findByProps({ testID: "client-notes-body" }).props.children).toBe("Gate code 4321\nAsk for Sam");
    expect(renderer.root.findByProps({ testID: "client-notes-legacy" }).props.children).toBe("Old alarm code 9999");
    expect(texts(renderer)).toContain("notes.legacyLabel");
    expect(texts(renderer)).not.toContain("notes.empty");
  });

  it("uses the given title key and hides the add action unless canAdd is set", async () => {
    const renderer = render({ titleKey: "notes.ticketTitle" });
    await flush();

    expect(texts(renderer)).toContain("notes.ticketTitle");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "notes.add" })).toHaveLength(0);
    expect(texts(renderer)).toContain("notes.empty");
  });

  it("collapses itself after loading when there are no notes and collapseWhenEmpty is set", async () => {
    const renderer = render({ collapseWhenEmpty: true });
    await flush();

    expect(texts(renderer)).not.toContain("notes.empty");
    expect(renderer.root.findByProps({ accessibilityLabel: "expand notes.title" })).toBeTruthy();
  });

  it("stays expanded with collapseWhenEmpty when notes exist", async () => {
    getClientNotesMock.mockResolvedValue({
      ok: true,
      data: { data: { document: {}, blockData: [paragraph("Parking behind the building")], lastUpdated: null } },
    });

    const renderer = render({ collapseWhenEmpty: true });
    await flush();

    expect(renderer.root.findByProps({ testID: "client-notes-body" }).props.children).toBe("Parking behind the building");
  });

  it("shows a load error with retry", async () => {
    getClientNotesMock
      .mockResolvedValueOnce({ ok: false, error: { kind: "network", message: "offline" } })
      .mockResolvedValueOnce({ ok: true, data: { data: { document: {}, blockData: [paragraph("Back online")], lastUpdated: null } } });

    const renderer = render();
    await flush();
    expect(texts(renderer)).toContain("notes.loadFailed");

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "notes.retry" }).props.onPress();
    });
    await flush();

    expect(renderer.root.findByProps({ testID: "client-notes-body" }).props.children).toBe("Back online");
  });

  it("appends a new note to the existing block array on save and reloads", async () => {
    const existing = [paragraph("Existing")];
    getClientNotesMock
      .mockResolvedValueOnce({ ok: true, data: { data: { document: {}, blockData: existing, lastUpdated: null } } })
      .mockResolvedValueOnce({ ok: true, data: { data: { document: {}, blockData: [...existing, paragraph("New from the field")], lastUpdated: null } } });

    const renderer = render({ canAdd: true });
    await flush();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "notes.add" }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "client-note-input" }).props.onChangeText("New from the field");
    });
    await act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: "client-note-submit" }).props.onPress();
    });
    await flush();

    expect(saveClientNotesMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clientId: "client-1",
      blockData: [
        existing[0],
        expect.objectContaining({ type: "paragraph", content: [expect.objectContaining({ text: "New from the field" })] }),
      ],
    }));
    expect(renderer.root.findByProps({ testID: "client-notes-body" }).props.children).toBe("Existing\nNew from the field");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "client-note-submit" })).toHaveLength(0);
  });

  it("keeps the note dialog open and shows the error when saving fails", async () => {
    saveClientNotesMock.mockResolvedValue({ ok: false, error: { kind: "server", message: "Permission denied" } });

    const renderer = render({ canAdd: true });
    await flush();
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "notes.add" }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "client-note-input" }).props.onChangeText("x");
    });
    await act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: "client-note-submit" }).props.onPress();
    });

    expect(texts(renderer)).toContain("Permission denied");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "client-note-submit" }).length).toBeGreaterThan(0);
  });
});
