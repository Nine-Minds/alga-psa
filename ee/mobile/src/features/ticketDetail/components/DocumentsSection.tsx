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
import { deleteTicketDocument, getTicketDocuments, uploadTicketDocument, type TicketDocument, type TicketDocumentUpload } from "../../../api/documents";
import { Badge } from "../../../ui/components/Badge";
import { Card } from "../../../ui/components/Card";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { formatDateTime } from "../../../ui/formatters/dateTime";
import { useTheme } from "../../../ui/ThemeContext";

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

export function DocumentsSection({
  client,
  apiKey,
  ticketId,
  baseUrl,
}: {
  client: ApiClient | null;
  apiKey: string;
  ticketId: string;
  baseUrl: string | null;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();
  const [documents, setDocuments] = useState<TicketDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachOptionsOpen, setAttachOptionsOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ uri: string; name: string } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const downloadBaseUrl = useMemo(() => baseUrl?.replace(/\/+$/, "") ?? null, [baseUrl]);

  const loadDocuments = useCallback(async () => {
    if (!client || !apiKey) return;
    setLoading(true);
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

  const submitUpload = useCallback(async (file: TicketDocumentUpload) => {
    if (!client || !apiKey) return;
    setUploading(true);
    setError(null);
    setAttachOptionsOpen(false);

    const result = await uploadTicketDocument(client, {
      apiKey,
      ticketId,
      file,
    });

    if (!result.ok) {
      setError(result.error.message || t("documents.errors.upload"));
      setUploading(false);
      return;
    }

    await loadDocuments();
    setUploading(false);
  }, [apiKey, client, loadDocuments, t, ticketId]);

  const handleCameraAttach = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(t("documents.errors.cameraPermission"));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) {
      return;
    }

    const asset = result.assets[0];
    await submitUpload({
      uri: asset.uri,
      name: asset.fileName ?? `ticket-photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? "image/jpeg",
    });
  }, [submitUpload, t]);

  const handleFileAttach = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || !result.assets?.[0]) {
      return;
    }

    const asset = result.assets[0];
    await submitUpload({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? "application/octet-stream",
    });
  }, [submitUpload]);

  const downloadDocumentFile = useCallback(async (document: TicketDocument): Promise<string | null> => {
    if (!downloadBaseUrl || !document.document_id) return null;

    const url = `${downloadBaseUrl}/api/v1/tickets/${ticketId}/documents/${document.document_id}`;
    const destination = new ExpoFile(Paths.cache, document.document_name);
    if (destination.exists) {
      destination.delete();
    }
    const file = await ExpoFile.downloadFileAsync(url, destination, {
      headers: { "x-api-key": apiKey },
    });

    return file.uri;
  }, [apiKey, downloadBaseUrl, ticketId]);

  const handleOpenDocument = useCallback(async (document: TicketDocument) => {
    if (!downloadBaseUrl || !document.document_id) {
      setError(t("documents.errors.open"));
      return;
    }

    setDownloading(document.document_id);
    setError(null);

    try {
      const isImage = (document.mime_type ?? "").startsWith("image/");

      if (isImage) {
        const uri = await downloadDocumentFile(document);
        if (!uri) throw new Error("Download failed");
        setPreviewImage({ uri, name: document.document_name });
      } else {
        const uri = await downloadDocumentFile(document);
        if (!uri) throw new Error("Download failed");
        await Sharing.shareAsync(uri, {
          mimeType: document.mime_type ?? undefined,
          dialogTitle: document.document_name,
        });
      }
    } catch (e) {
      logger.error("[DocumentsSection] open failed", { error: e });
      setError(t("documents.errors.open"));
    } finally {
      setDownloading(null);
    }
  }, [downloadBaseUrl, downloadDocumentFile, t]);

  const handleSaveDocument = useCallback(async (document: TicketDocument) => {
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
      logger.error("[DocumentsSection] save failed", { error: e });
      setError(t("documents.errors.open"));
    } finally {
      setDownloading(null);
    }
  }, [downloadBaseUrl, downloadDocumentFile, t]);

  const [deleting, setDeleting] = useState<string | null>(null);

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
                await loadDocuments();
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

  return (
    <Card accessibilityLabel={t("documents.title")}>
      <SectionHeader
        title={t("documents.title")}
        action={(
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Badge label={String(documents.length)} tone="neutral" />
            <PrimaryButton onPress={() => setAttachOptionsOpen((value) => !value)} accessibilityLabel={t("documents.attach")}>
              {t("documents.attach")}
            </PrimaryButton>
          </View>
        )}
      />

      {attachOptionsOpen ? (
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
          <Pressable
            onPress={() => { void handleCameraAttach(); }}
            accessibilityRole="button"
            accessibilityLabel={t("documents.camera")}
            style={{
              flex: 1,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              alignItems: "center",
            }}
          >
            <Text style={{ ...typography.body, color: colors.text }}>{t("documents.camera")}</Text>
          </Pressable>
          <Pressable
            onPress={() => { void handleFileAttach(); }}
            accessibilityRole="button"
            accessibilityLabel={t("documents.file")}
            style={{
              flex: 1,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              alignItems: "center",
            }}
          >
            <Text style={{ ...typography.body, color: colors.text }}>{t("documents.file")}</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}

      {uploading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t("documents.uploading")}</Text>
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
              onLongPress={() => { void handleSaveDocument(document); }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.sm,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                opacity: downloading === document.document_id ? 0.6 : 1,
              }}
            >
              {downloading === document.document_id ? (
                <ActivityIndicator size={18} color={colors.textSecondary} />
              ) : (
                <Feather name={getDocumentIcon(document)} size={18} color={colors.textSecondary} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.body, color: colors.text }}>
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
      {previewImage ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewImage(null)}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" }}>
            <Pressable
              onPress={() => setPreviewImage(null)}
              accessibilityRole="button"
              accessibilityLabel={t("documents.closePreview")}
              style={{ position: "absolute", top: 56, right: 16, zIndex: 1, padding: spacing.sm }}
            >
              <Feather name="x" size={28} color="#fff" />
            </Pressable>
            <Text
              style={{ ...typography.body, color: "#fff", position: "absolute", top: 60, left: 16, right: 60 }}
              numberOfLines={1}
            >
              {previewImage.name}
            </Text>
            <Image
              source={{ uri: previewImage.uri }}
              style={{ width: "90%", height: "70%" }}
              resizeMode="contain"
            />
          </View>
        </Modal>
      ) : null}
    </Card>
  );
}
