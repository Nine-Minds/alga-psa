import React from "react";
import { Linking, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTicketDocumentsMock = vi.fn();
const uploadTicketDocumentMock = vi.fn();
const downloadAsyncMock = vi.fn();
const requestCameraPermissionsAsyncMock = vi.fn();
const launchCameraAsyncMock = vi.fn();
const getDocumentAsyncMock = vi.fn();
const translate = (key: string) => key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock("../../../ui/components/Badge", () => ({
  Badge: (props: Record<string, unknown>) => React.createElement("MockBadge", props, props.label as React.ReactNode),
}));

vi.mock("../../../ui/components/Card", () => ({
  Card: (props: Record<string, unknown>) => React.createElement("MockCard", props, props.children as React.ReactNode),
}));

vi.mock("../../../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) =>
    React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));

vi.mock("../../../ui/components/SectionHeader", () => ({
  SectionHeader: (props: Record<string, unknown>) => React.createElement("MockSectionHeader", props, props.action as React.ReactNode),
}));

vi.mock("../../../api/documents", () => ({
  getTicketDocuments: (...args: unknown[]) => getTicketDocumentsMock(...args),
  uploadTicketDocument: (...args: unknown[]) => uploadTicketDocumentMock(...args),
}));

vi.mock("expo-file-system", () => ({
  cacheDirectory: "file:///cache/",
  documentDirectory: "file:///documents/",
  downloadAsync: (...args: unknown[]) => downloadAsyncMock(...args),
}));

vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: (...args: unknown[]) => requestCameraPermissionsAsyncMock(...args),
  launchCameraAsync: (...args: unknown[]) => launchCameraAsyncMock(...args),
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: unknown[]) => getDocumentAsyncMock(...args),
}));

import { DocumentsSection } from "./DocumentsSection";

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderSection(): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      React.createElement(DocumentsSection, {
        client: { request: vi.fn() },
        apiKey: "api-key-1",
        ticketId: "ticket-1",
        baseUrl: "https://example.com",
      }),
    );
  });

  if (!renderer) {
    throw new Error("Renderer was not created");
  }

  return renderer;
}

function getTextContent(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

describe("DocumentsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketDocumentsMock.mockResolvedValue({ ok: true, data: { data: [] } });
    uploadTicketDocumentMock.mockResolvedValue({ ok: true, data: { data: { document_id: "doc-1" } } });
    downloadAsyncMock.mockResolvedValue({ uri: "file:///cache/report.pdf" });
    requestCameraPermissionsAsyncMock.mockResolvedValue({ granted: true });
    launchCameraAsyncMock.mockResolvedValue({ canceled: true, assets: [] });
    getDocumentAsyncMock.mockResolvedValue({ canceled: true, assets: [] });
    vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  });

  it("renders the document list, count badge, and metadata", async () => {
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            document_id: "doc-1",
            document_name: "report.pdf",
            type_name: "PDF",
            mime_type: "application/pdf",
            file_size: 42000,
            updated_at: "2026-03-26T12:00:00.000Z",
            file_id: "file-1",
          },
        ],
      },
    });

    const renderer = renderSection();
    await flushAsyncWork();
    const textContent = getTextContent(renderer);

    expect(textContent).toContain("report.pdf");
    expect(textContent.some((value) => value.includes("PDF"))).toBe(true);
    expect(renderer.root.findByType("MockBadge").props.label).toBe("1");
  });

  it("shows the empty state when no documents are attached", async () => {
    const renderer = renderSection();
    await flushAsyncWork();
    expect(getTextContent(renderer)).toContain("documents.empty");
  });

  it("downloads and opens a tapped document", async () => {
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            document_id: "doc-1",
            document_name: "report.pdf",
            type_name: "PDF",
            mime_type: "application/pdf",
            file_size: 42000,
            updated_at: "2026-03-26T12:00:00.000Z",
            file_id: "file-1",
          },
        ],
      },
    });

    const renderer = renderSection();
    await flushAsyncWork();
    const documentPressable = renderer.root.findByProps({ accessibilityLabel: "report.pdf" });

    await act(async () => {
      await documentPressable.props.onPress();
    });

    expect(downloadAsyncMock).toHaveBeenCalledWith(
      "https://example.com/api/documents/download/file-1",
      "file:///cache/report.pdf",
      {
        headers: {
          "x-api-key": "api-key-1",
        },
      },
    );
    expect(Linking.openURL).toHaveBeenCalledWith("file:///cache/report.pdf");
  });

  it("shows upload options and uploads a picked file, then refreshes the list", async () => {
    getTicketDocumentsMock
      .mockResolvedValueOnce({ ok: true, data: { data: [] } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          data: [
            {
              document_id: "doc-2",
              document_name: "invoice.pdf",
              type_name: "PDF",
              mime_type: "application/pdf",
              file_size: 1200,
              updated_at: "2026-03-26T12:00:00.000Z",
              file_id: "file-2",
            },
          ],
        },
      });
    getDocumentAsyncMock.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/invoice.pdf",
          name: "invoice.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    const renderer = renderSection();
    await flushAsyncWork();
    const attachButton = renderer.root.findByProps({ accessibilityLabel: "documents.attach" });

    await act(async () => {
      attachButton.props.onPress();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: "documents.camera" })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: "documents.file" })).toBeTruthy();

    await act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: "documents.file" }).props.onPress();
    });
    await flushAsyncWork();

    expect(getDocumentAsyncMock).toHaveBeenCalled();
    expect(uploadTicketDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ticketId: "ticket-1",
        file: expect.objectContaining({
          uri: "file:///tmp/invoice.pdf",
          name: "invoice.pdf",
          mimeType: "application/pdf",
        }),
      }),
    );
    expect(getTicketDocumentsMock).toHaveBeenCalledTimes(2);
    expect(getTextContent(renderer)).toContain("invoice.pdf");
  });

  it("shows an upload progress indicator while an upload is in flight", async () => {
    let resolveUpload: ((value: unknown) => void) | null = null;
    uploadTicketDocumentMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    getDocumentAsyncMock.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/invoice.pdf",
          name: "invoice.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    const renderer = renderSection();
    await flushAsyncWork();
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "documents.attach" }).props.onPress();
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "documents.file" }).props.onPress();
    });

    expect(getTextContent(renderer)).toContain("documents.uploading");

    await act(async () => {
      resolveUpload?.({ ok: true, data: { data: { document_id: "doc-1" } } });
    });
    await flushAsyncWork();
  });

  it("shows an error when upload fails", async () => {
    uploadTicketDocumentMock.mockResolvedValue({
      ok: false,
      error: { message: "upload failed" },
    });
    getDocumentAsyncMock.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/invoice.pdf",
          name: "invoice.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    const renderer = renderSection();
    await flushAsyncWork();
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "documents.attach" }).props.onPress();
    });

    await act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: "documents.file" }).props.onPress();
    });
    await flushAsyncWork();

    expect(getTextContent(renderer)).toContain("upload failed");
  });

  it("shows a camera permission error when camera access is denied", async () => {
    requestCameraPermissionsAsyncMock.mockResolvedValue({ granted: false });

    const renderer = renderSection();
    await flushAsyncWork();
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "documents.attach" }).props.onPress();
    });

    await act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: "documents.camera" }).props.onPress();
    });
    await flushAsyncWork();

    expect(getTextContent(renderer)).toContain("documents.errors.cameraPermission");
  });
});
