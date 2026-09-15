import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useTranslation } from "react-i18next";
import { logger } from "../../../logging/logger";
import type { ApiClient } from "../../../api";
import {
  deleteTicketDocument,
  getTicketDocuments,
  isImageDocument,
  ticketDocumentUrl,
  type TicketDocument,
  type TicketDocumentUpload,
} from "../../../api/documents";
import { Badge } from "../../../ui/components/Badge";
import { Card } from "../../../ui/components/Card";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { formatDateTime } from "../../../ui/formatters/dateTime";
import { useTheme } from "../../../ui/ThemeContext";
import { useDocumentUploadQueue } from "../hooks/useDocumentUploadQueue";
import { SectionCollapseToggle } from "./SectionCollapseToggle";

const THUMBNAIL_SIZE = 44;

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} KB`;
  return `${value} B`;
}

function getDocumentIcon(document: TicketDocument): keyof typeof Feather.glyphMap {
  const mimeType = document.mime_type ?? "";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("pdf")) return "file-text";
  return "paperclip";
}

function pickedImageToUpload(asset: ImagePicker.ImagePickerAsset, fallbackName: string): TicketDocumentUpload {
  return {
    uri: asset.uri,
    name: asset.fileName ?? fallbackName,
    mimeType: asset.mimeType ?? "image/jpeg",
  };
}

export function DocumentsSection({
  client,
  apiKey,
  ticketId,
  baseUrl,
  initiallyCollapsed = false,
}: {
  client: ApiClient | null;
  apiKey: string;
  ticketId: string;
  baseUrl: string | null;
  initiallyCollapsed?: boolean;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();
  const [documents, setDocuments] = useState<TicketDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attachOptionsOpen, setAttachOptionsOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFallbackUris, setPreviewFallbackUris] = useState<Record<string, string>>({});
  const [brokenThumbnails, setBrokenThumbnails] = useState<Record<string, true>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  const downloadBaseUrl = useMemo(() => baseUrl?.replace(/\/+$/, "") ?? null, [baseUrl]);
  const authHeaders = useMemo(() => ({ "x-api-key": apiKey }), [apiKey]);
  const imageDocuments = useMemo(() => documents.filter(isImageDocument), [documents]);
  const previewDocument = previewIndex === null ? null : imageDocuments[previewIndex] ?? null;

  const loadDocuments = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!client || !apiKey) return;
    if (!options.silent) setLoading(true);
    setError(null);
    const result = await getTicketDocuments(client, { apiKey, ticketId });
    if (!result.ok) {
      setError(t("documents.errors.load"));
      setLoading(false);
      return;
    }
    setDocuments(result.data.data);
    setLoading(false);
  }, [apiKey, client, t, ticketId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const uploads = useDocumentUploadQueue({
    client,
    apiKey,
    ticketId,
    onUploaded: () => loadDocuments({ silent: true }),
    fallbackError: t("documents.errors.upload"),
  });

  const enqueueUploads = useCallback((files: TicketDocumentUpload[]) => {
    if (files.length === 0) return;
    setError(null);
    setAttachOptionsOpen(false);
    uploads.enqueue(files);
  }, [uploads]);

  const handleCameraAttach = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(t("documents.errors.cameraPermission"));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;

    enqueueUploads([pickedImageToUpload(result.assets[0], `ticket-photo-${Date.now()}.jpg`)]);
  }, [enqueueUploads, t]);

  const handlePhotosAttach = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t("documents.errors.photosPermission"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      orderedSelection: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    const stamp = Date.now();
    enqueueUploads(result.assets.map((asset, index) => pickedImageToUpload(asset, `ticket-photo-${stamp}-${index + 1}.jpg`)));
  }, [enqueueUploads, t]);

  const handleFileAttach = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled || !result.assets?.length) return;

    enqueueUploads(result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? "application/octet-stream",
    })));
  }, [enqueueUploads]);

  const downloadDocumentFile = useCallback(async (document: TicketDocument): Promise<string | null> => {
    if (!downloadBaseUrl || !document.document_id) return null;

    const url = ticketDocumentUrl(downloadBaseUrl, ticketId, document.document_id);
    const destination = new ExpoFile(Paths.cache, document.document_name);
    if (destination.exists) {
      destination.delete();
    }
    const file = await ExpoFile.downloadFileAsync(url, destination, { headers: authHeaders });

    return file.uri;
  }, [authHeaders, downloadBaseUrl, ticketId]);

  const shareDocument = useCallback(async (document: TicketDocument, failureKey: string) => {
    if (!downloadBaseUrl || !document.document_id) {
      setError(t("documents.errors.open"));
      return;
    }

    setDownloading(document.document_id);
    setError(null);

    try {
      const uri = await downloadDocumentFile(document);
      if (!uri) throw new Error("Download failed");
      await Sharing.shareAsync(uri, {
        mimeType: document.mime_type ?? undefined,
        dialogTitle: document.document_name,
      });
    } catch (e) {
      logger.error(`[DocumentsSection] ${failureKey} failed`, { error: e });
      setError(t("documents.errors.open"));
    } finally {
      setDownloading(null);
    }
  }, [downloadBaseUrl, downloadDocumentFile, t]);

  const handleOpenDocument = useCallback(async (document: TicketDocument) => {
    if (isImageDocument(document) && downloadBaseUrl) {
      const index = imageDocuments.findIndex((candidate) => candidate.document_id === document.document_id);
      if (index >= 0) {
        setError(null);
        setPreviewLoading(true);
        setPreviewIndex(index);
        return;
      }
    }
    await shareDocument(document, "open");
  }, [downloadBaseUrl, imageDocuments, shareDocument]);

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
    setPreviewLoading(false);
  }, []);

  const stepPreview = useCallback((delta: number) => {
    setPreviewIndex((current) => {
      if (current === null) return current;
      const next = current + delta;
      if (next < 0 || next >= imageDocuments.length) return current;
      setPreviewLoading(true);
      return next;
    });
  }, [imageDocuments.length]);

  // The 800x600 preview variant failed (older upload without a preview, or
  // offline cache miss): fall back to the original file once.
  const handlePreviewError = useCallback(async (document: TicketDocument) => {
    if (previewFallbackUris[document.document_id]) {
      setPreviewLoading(false);
      setError(t("documents.errors.preview"));
      return;
    }
    try {
      const uri = await downloadDocumentFile(document);
      if (!uri) throw new Error("Download failed");
      setPreviewFallbackUris((current) => ({ ...current, [document.document_id]: uri }));
    } catch (e) {
      logger.error("[DocumentsSection] preview fallback failed", { error: e });
      setPreviewLoading(false);
      setError(t("documents.errors.preview"));
    }
  }, [downloadDocumentFile, previewFallbackUris, t]);

  const handleDeleteDocument = useCallback((document: TicketDocument) => {
    Alert.alert(
      t("documents.deleteConfirmTitle"),
      t("documents.deleteConfirmMessage", { name: document.document_name }),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("documents.delete"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (!client || !apiKey) return;
              setDeleting(document.document_id);
              setError(null);
              try {
                const result = await deleteTicketDocument(client, {
                  apiKey,
                  ticketId,
                  documentId: document.document_id,
                });
                if (!result.ok) {
                  setError(result.error.message || t("documents.errors.delete"));
                  return;
                }
                await loadDocuments({ silent: true });
              } catch (e) {
                logger.error("[DocumentsSection] delete failed", { error: e });
                setError(t("documents.errors.delete"));
              } finally {
                setDeleting(null);
              }
            })();
          },
        },
      ],
    );
  }, [apiKey, client, loadDocuments, t, ticketId]);

  const attachOptionStyle = {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center" as const,
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    gap: spacing.xs,
  };

  const renderThumbnail = (document: TicketDocument) => {
    const showThumbnail = isImageDocument(document) && downloadBaseUrl && !brokenThumbnails[document.document_id];
    if (downloading === document.document_id) {
      return (
        <View style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size={18} color={colors.textSecondary} />
        </View>
      );
    }
    if (showThumbnail) {
      return (
        <Image
          testID={`document-thumbnail-${document.document_id}`}
          accessibilityIgnoresInvertColors
          source={{ uri: ticketDocumentUrl(downloadBaseUrl, ticketId, document.document_id, "thumbnail"), headers: authHeaders }}
          onError={() => setBrokenThumbnails((current) => ({ ...current, [document.document_id]: true }))}
          style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, borderRadius: 8, backgroundColor: colors.border }}
          resizeMode="cover"
        />
      );
    }
    return (
      <View style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, alignItems: "center", justifyContent: "center" }}>
        <Feather name={getDocumentIcon(document)} size={20} color={colors.textSecondary} />
      </View>
    );
  };

  const previewUri = previewDocument && downloadBaseUrl
    ? previewFallbackUris[previewDocument.document_id]
      ?? ticketDocumentUrl(downloadBaseUrl, ticketId, previewDocument.document_id, "preview")
    : null;
  const previewUsesFallback = Boolean(previewDocument && previewFallbackUris[previewDocument.document_id]);

  return (
    <Card accessibilityLabel={t("documents.title")}>
      <SectionHeader
        title={t("documents.title")}
        action={(
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Badge label={String(documents.length)} tone="neutral" />
            {!collapsed ? (
              <PrimaryButton onPress={() => setAttachOptionsOpen((value) => !value)} accessibilityLabel={t("documents.attach")}>
                {t("documents.attach")}
              </PrimaryButton>
            ) : null}
            <SectionCollapseToggle
              collapsed={collapsed}
              onToggle={() => setCollapsed((value) => !value)}
              sectionLabel={t("documents.title")}
            />
          </View>
        )}
      />

      {collapsed ? null : <>
      {attachOptionsOpen ? (
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
          <Pressable
            onPress={() => { void handleCameraAttach(); }}
            accessibilityRole="button"
            accessibilityLabel={t("documents.camera")}
            style={attachOptionStyle}
          >
            <Feather name="camera" size={16} color={colors.text} />
            <Text style={{ ...typography.body, color: colors.text }}>{t("documents.camera")}</Text>
          </Pressable>
          <Pressable
            onPress={() => { void handlePhotosAttach(); }}
            accessibilityRole="button"
            accessibilityLabel={t("documents.photos")}
            style={attachOptionStyle}
          >
            <Feather name="image" size={16} color={colors.text} />
            <Text style={{ ...typography.body, color: colors.text }}>{t("documents.photos")}</Text>
          </Pressable>
          <Pressable
            onPress={() => { void handleFileAttach(); }}
            accessibilityRole="button"
            accessibilityLabel={t("documents.file")}
            style={attachOptionStyle}
          >
            <Feather name="paperclip" size={16} color={colors.text} />
            <Text style={{ ...typography.body, color: colors.text }}>{t("documents.file")}</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}

      {uploads.progress ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>
            {uploads.progress.total > 1
              ? t("documents.uploadingProgress", { current: uploads.progress.current, total: uploads.progress.total })
              : t("documents.uploading")}
          </Text>
        </View>
      ) : null}

      {uploads.failed.length > 0 ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {uploads.failed.map((item) => (
            <View
              key={item.id}
              accessibilityLabel={`${t("documents.uploadFailed")}: ${item.file.name}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.sm,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.danger,
                backgroundColor: colors.card,
              }}
            >
              <Feather name="alert-circle" size={18} color={colors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.body, color: colors.text }} numberOfLines={1}>{item.file.name}</Text>
                <Text style={{ ...typography.caption, color: colors.danger, marginTop: 2 }}>{item.error}</Text>
              </View>
              <Pressable
                onPress={() => uploads.retry(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${t("documents.retry")} ${item.file.name}`}
                hitSlop={8}
                style={{ padding: spacing.xs }}
              >
                <Text style={{ ...typography.body, color: colors.primary }}>{t("documents.retry")}</Text>
              </Pressable>
              <Pressable
                onPress={() => uploads.dismiss(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${t("documents.dismiss")} ${item.file.name}`}
                hitSlop={8}
                style={{ padding: spacing.xs }}
              >
                <Feather name="x" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {loading ? (
        <View style={{ marginTop: spacing.md, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : documents.length === 0 ? (
        <Text style={{ ...typography.body, color: colors.textSecondary, marginTop: spacing.md }}>
          {t("documents.empty")}
        </Text>
      ) : (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {documents.map((document) => (
            <Pressable
              key={document.document_id}
              accessibilityRole="button"
              accessibilityLabel={document.document_name}
              disabled={downloading === document.document_id}
              onPress={() => { void handleOpenDocument(document); }}
              onLongPress={() => { void shareDocument(document, "save"); }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingVertical: spacing.xs,
                paddingHorizontal: spacing.sm,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                opacity: downloading === document.document_id ? 0.6 : 1,
              }}
            >
              {renderThumbnail(document)}
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.body, color: colors.text }} numberOfLines={1}>
                  {document.document_name}
                </Text>
                <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                  {[document.type_name ?? t("documents.unknownType"), formatBytes(document.file_size), formatDateTime(document.updated_at)].join(" • ")}
                </Text>
              </View>
              <Pressable
                onPress={() => handleDeleteDocument(document)}
                disabled={deleting === document.document_id}
                accessibilityRole="button"
                accessibilityLabel={t("documents.delete")}
                hitSlop={8}
                style={{ padding: spacing.xs }}
              >
                {deleting === document.document_id ? (
                  <ActivityIndicator size={16} color={colors.danger} />
                ) : (
                  <Feather name="trash-2" size={16} color={colors.danger} />
                )}
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}
      </>}
      {previewDocument && previewUri ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={closePreview}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" }}>
            <Text
              style={{ ...typography.body, color: "#fff", position: "absolute", top: 60, left: 16, right: 120 }}
              numberOfLines={1}
            >
              {previewDocument.document_name}
            </Text>
            <View style={{ position: "absolute", top: 48, right: 8, zIndex: 1, flexDirection: "row", alignItems: "center" }}>
              <Pressable
                onPress={() => { void shareDocument(previewDocument, "share"); }}
                disabled={downloading === previewDocument.document_id}
                accessibilityRole="button"
                accessibilityLabel={t("documents.share")}
                hitSlop={8}
                style={{ padding: spacing.sm }}
              >
                {downloading === previewDocument.document_id ? (
                  <ActivityIndicator size={22} color="#fff" />
                ) : (
                  <Feather name="share" size={24} color="#fff" />
                )}
              </Pressable>
              <Pressable
                onPress={closePreview}
                accessibilityRole="button"
                accessibilityLabel={t("documents.closePreview")}
                hitSlop={8}
                style={{ padding: spacing.sm }}
              >
                <Feather name="x" size={28} color="#fff" />
              </Pressable>
            </View>
            <Image
              key={`${previewDocument.document_id}:${previewUsesFallback ? "full" : "preview"}`}
              testID="preview-image"
              accessibilityIgnoresInvertColors
              source={{ uri: previewUri, headers: previewUsesFallback ? undefined : authHeaders }}
              onLoadEnd={() => setPreviewLoading(false)}
              onError={() => { void handlePreviewError(previewDocument); }}
              style={{ width: "90%", height: "70%" }}
              resizeMode="contain"
            />
            {previewLoading ? (
              <ActivityIndicator size="large" color="#fff" style={{ position: "absolute" }} />
            ) : null}
            {imageDocuments.length > 1 ? (
              <View
                style={{
                  position: "absolute",
                  bottom: 48,
                  left: 16,
                  right: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Pressable
                  onPress={() => stepPreview(-1)}
                  disabled={previewIndex === 0}
                  accessibilityRole="button"
                  accessibilityLabel={t("documents.previousImage")}
                  hitSlop={8}
                  style={{ padding: spacing.sm, opacity: previewIndex === 0 ? 0.3 : 1 }}
                >
                  <Feather name="chevron-left" size={32} color="#fff" />
                </Pressable>
                <Text style={{ ...typography.body, color: "#fff" }}>
                  {t("documents.previewCounter", { current: (previewIndex ?? 0) + 1, total: imageDocuments.length })}
                </Text>
                <Pressable
                  onPress={() => stepPreview(1)}
                  disabled={previewIndex === imageDocuments.length - 1}
                  accessibilityRole="button"
                  accessibilityLabel={t("documents.nextImage")}
                  hitSlop={8}
                  style={{ padding: spacing.sm, opacity: previewIndex === imageDocuments.length - 1 ? 0.3 : 1 }}
                >
                  <Feather name="chevron-right" size={32} color="#fff" />
                </Pressable>
              </View>
            ) : null}
          </View>
        </Modal>
      ) : null}
    </Card>
  );
}
