import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

function MockModal(props: Record<string, unknown>) {
  return props.visible
    ? React.createElement("MockModal", { ...props, testID: "preview-modal" }, props.children as React.ReactNode)
    : null;
}
function MockImage(props: Record<string, unknown>) {
  return React.createElement("MockImage", { ...props, testID: "preview-image" });
}

const mockAlert = vi.fn();
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return {
    ...actual,
    Modal: MockModal,
    Image: MockImage,
    Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
  };
});

const getTicketDocumentsMock = vi.fn();
const uploadTicketDocumentMock = vi.fn();
const deleteTicketDocumentMock = vi.fn();
const requestCameraPermissionsAsyncMock = vi.fn();
const launchCameraAsyncMock = vi.fn();
const getDocumentAsyncMock = vi.fn();
const downloadFileAsyncMock = vi.fn();
const shareAsyncMock = vi.fn();
const translate = (key: string) => key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

function MockBadge(props: Record<string, unknown>) { return React.createElement("span", props, props.label as React.ReactNode); }
vi.mock("../../../ui/components/Badge", () => ({
  Badge: MockBadge,
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
  deleteTicketDocument: (...args: unknown[]) => deleteTicketDocumentMock(...args),
}));

const mockFileUri = "file:///cache/test-file";
const mockFileExists = vi.fn().mockReturnValue(false);
const mockFileDelete = vi.fn();

vi.mock("expo-file-system", () => {
  class MockFile {
    uri = mockFileUri;
    get exists() { return mockFileExists(); }
    delete = mockFileDelete;
    static downloadFileAsync = (...args: unknown[]) => downloadFileAsyncMock(...args);
  }
  class MockDirectory {}
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { cache: { uri: "file:///cache/" } },
  };
});

vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: (...args: unknown[]) => requestCameraPermissionsAsyncMock(...args),
  launchCameraAsync: (...args: unknown[]) => launchCameraAsyncMock(...args),
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: unknown[]) => getDocumentAsyncMock(...args),
}));

vi.mock("expo-sharing", () => ({
  shareAsync: (...args: unknown[]) => shareAsyncMock(...args),
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

const imageDoc = {
  document_id: "doc-img",
  document_name: "photo.jpg",
  type_name: "Image",
  mime_type: "image/jpeg",
  file_size: 50000,
  updated_at: "2026-03-26T12:00:00.000Z",
  file_id: "file-img",
};

const pdfDoc = {
  document_id: "doc-1",
  document_name: "report.pdf",
  type_name: "PDF",
  mime_type: "application/pdf",
  file_size: 42000,
  updated_at: "2026-03-26T12:00:00.000Z",
  file_id: "file-1",
};

describe("DocumentsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketDocumentsMock.mockResolvedValue({ ok: true, data: { data: [] } });
    uploadTicketDocumentMock.mockResolvedValue({ ok: true, data: { data: { document_id: "doc-1" } } });
    deleteTicketDocumentMock.mockResolvedValue({ ok: true, data: { data: null } });
    downloadFileAsyncMock.mockResolvedValue({ uri: mockFileUri });
    shareAsyncMock.mockResolvedValue(undefined);
    requestCameraPermissionsAsyncMock.mockResolvedValue({ granted: true });
    launchCameraAsyncMock.mockResolvedValue({ canceled: true, assets: [] });
    getDocumentAsyncMock.mockResolvedValue({ canceled: true, assets: [] });
    mockFileExists.mockReturnValue(false);
  });

  it("renders the document list, count badge, and metadata", async () => {
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [pdfDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();
    const textContent = getTextContent(renderer);

    expect(textContent).toContain("report.pdf");
    expect(textContent.some((value) => value.includes("PDF"))).toBe(true);
    expect(renderer.root.findByType(MockBadge).props.label).toBe("1");
  });

  it("shows the empty state when no documents are attached", async () => {
    const renderer = renderSection();
    await flushAsyncWork();
    expect(getTextContent(renderer)).toContain("documents.empty");
  });

  it("downloads and opens share sheet for a tapped non-image document", async () => {
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [pdfDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();
    const documentPressable = renderer.root.findByProps({ accessibilityLabel: "report.pdf" });

    await act(async () => {
      await documentPressable.props.onPress();
    });

    expect(downloadFileAsyncMock).toHaveBeenCalledWith(
      "https://example.com/api/v1/tickets/ticket-1/documents/doc-1",
      expect.anything(),
      { headers: { "x-api-key": "api-key-1" } },
    );
    expect(shareAsyncMock).toHaveBeenCalledWith(mockFileUri, {
      mimeType: "application/pdf",
      dialogTitle: "report.pdf",
    });
  });

  it("opens image preview modal when tapping an image document", async () => {
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [imageDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();
    const documentPressable = renderer.root.findByProps({ accessibilityLabel: "photo.jpg" });

    await act(async () => {
      await documentPressable.props.onPress();
    });

    // Share sheet should NOT be shown for images
    expect(shareAsyncMock).not.toHaveBeenCalled();

    // Image preview modal should be visible
    const modal = renderer.root.findAllByProps({ testID: "preview-modal" });
    expect(modal.length).toBe(1);

    // Preview image rendered
    const previewImage = renderer.root.findAllByProps({ testID: "preview-image" });
    expect(previewImage.length).toBe(1);
    expect(previewImage[0].props.source.uri).toBe(mockFileUri);

    // File name shown in preview
    const previewTexts = getTextContent(renderer);
    expect(previewTexts).toContain("photo.jpg");
  });

  it("closes image preview when tapping the close button", async () => {
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [imageDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    // Open preview
    await act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: "photo.jpg" }).props.onPress();
    });

    expect(renderer.root.findAllByProps({ testID: "preview-modal" }).length).toBe(1);

    // Close preview
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: "documents.closePreview" }).props.onPress();
    });

    // Modal should be gone
    expect(renderer.root.findAllByProps({ testID: "preview-modal" }).length).toBe(0);
  });

  it("opens share sheet on long press for any document type", async () => {
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [imageDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();
    const documentPressable = renderer.root.findByProps({ accessibilityLabel: "photo.jpg" });

    await act(async () => {
      await documentPressable.props.onLongPress();
    });

    // Long press always opens share sheet, even for images
    expect(shareAsyncMock).toHaveBeenCalledWith(mockFileUri, {
      mimeType: "image/jpeg",
      dialogTitle: "photo.jpg",
    });
  });

  it("deletes existing cached file before downloading", async () => {
    mockFileExists.mockReturnValue(true);
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [pdfDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    await act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: "report.pdf" }).props.onPress();
    });

    expect(mockFileDelete).toHaveBeenCalled();
    expect(downloadFileAsyncMock).toHaveBeenCalled();
  });

  it("shows error when download fails", async () => {
    downloadFileAsyncMock.mockRejectedValue(new Error("Network error"));
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [pdfDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    await act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: "report.pdf" }).props.onPress();
    });

    expect(getTextContent(renderer)).toContain("documents.errors.open");
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

  it("shows confirmation alert when tapping delete button", async () => {
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [pdfDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    const deleteButton = renderer.root.findByProps({ accessibilityLabel: "documents.delete" });
    await act(async () => {
      deleteButton.props.onPress();
    });

    expect(mockAlert).toHaveBeenCalledWith(
      "documents.deleteConfirmTitle",
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ style: "cancel" }),
        expect.objectContaining({ style: "destructive" }),
      ]),
    );
  });

  it("deletes document and refreshes list after confirmation", async () => {
    getTicketDocumentsMock
      .mockResolvedValueOnce({ ok: true, data: { data: [pdfDoc] } })
      .mockResolvedValueOnce({ ok: true, data: { data: [] } });

    const renderer = renderSection();
    await flushAsyncWork();

    const deleteButton = renderer.root.findByProps({ accessibilityLabel: "documents.delete" });
    await act(async () => {
      deleteButton.props.onPress();
    });

    // Simulate user pressing destructive button in the alert
    const alertButtons = mockAlert.mock.calls[0][2] as Array<{ onPress?: () => void; style: string }>;
    const destructiveButton = alertButtons.find((b) => b.style === "destructive");

    await act(async () => {
      destructiveButton?.onPress?.();
    });
    await flushAsyncWork();

    expect(deleteTicketDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        apiKey: "api-key-1",
        ticketId: "ticket-1",
        documentId: "doc-1",
      }),
    );
    // Should refresh the list after delete
    expect(getTicketDocumentsMock).toHaveBeenCalledTimes(2);
  });

  it("shows error when delete fails", async () => {
    deleteTicketDocumentMock.mockResolvedValue({
      ok: false,
      error: { message: "delete failed" },
    });
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [pdfDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    const deleteButton = renderer.root.findByProps({ accessibilityLabel: "documents.delete" });
    await act(async () => {
      deleteButton.props.onPress();
    });

    const alertButtons = mockAlert.mock.calls[0][2] as Array<{ onPress?: () => void; style: string }>;
    const destructiveButton = alertButtons.find((b) => b.style === "destructive");

    await act(async () => {
      destructiveButton?.onPress?.();
    });
    await flushAsyncWork();

    expect(getTextContent(renderer)).toContain("delete failed");
  });

  it("disables the row and shows spinner while downloading", async () => {
    let resolveDownload: ((value: unknown) => void) | null = null;
    downloadFileAsyncMock.mockImplementation(
      () => new Promise((resolve) => { resolveDownload = resolve; }),
    );
    getTicketDocumentsMock.mockResolvedValue({
      ok: true,
      data: { data: [pdfDoc] },
    });

    const renderer = renderSection();
    await flushAsyncWork();

    // Start download (don't await — it's pending)
    act(() => {
      void renderer.root.findByProps({ accessibilityLabel: "report.pdf" }).props.onPress();
    });

    // Row should be disabled and dimmed
    const row = renderer.root.findByProps({ accessibilityLabel: "report.pdf" });
    expect(row.props.disabled).toBe(true);
    expect(row.props.style).toEqual(expect.objectContaining({ opacity: 0.6 }));

    // Resolve to clean up
    await act(async () => {
      resolveDownload?.({ uri: mockFileUri });
    });
  });
});
