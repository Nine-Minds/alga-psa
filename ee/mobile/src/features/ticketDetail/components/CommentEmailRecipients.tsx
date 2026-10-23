import React, { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SUGGESTION_DEBOUNCE_MS = 250;

/** A contact of the ticket's client, offered while the agent types a name. */
export type CommentRecipientSuggestion = { email: string; name?: string };

/** Looks up the ticket client's contacts; the screen owns the API call. */
export type CommentRecipientSearch = (
  query: string,
  signal: AbortSignal,
) => Promise<CommentRecipientSuggestion[]>;

/** Splits a typed or pasted list on comma, semicolon and newline. */
export function parseCommentRecipients(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    if (EMAIL_PATTERN.test(entry)) valid.push(entry);
    else invalid.push(entry);
  }
  return { valid, invalid };
}

function RecipientRow({
  testID,
  label,
  value,
  onChange,
  searchRecipients,
}: {
  testID: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  searchRecipients?: CommentRecipientSearch;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<CommentRecipientSuggestion[]>([]);

  const add = (entries: string[]) => {
    const existing = new Set(value.map((entry) => entry.toLowerCase()));
    const added = entries.filter((entry) => {
      const key = entry.toLowerCase();
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (added.length) onChange([...value, ...added]);
  };

  const commit = () => {
    if (!draft.trim()) {
      setInvalid([]);
      return;
    }
    const parsed = parseCommentRecipients(draft);
    add(parsed.valid);
    setInvalid(parsed.invalid);
    setDraft(parsed.invalid.join(", "));
    setSuggestions([]);
  };

  // A typed name looks up the ticket client's contacts; a typed address does
  // not need a lookup, and neither does a blur-committed draft.
  useEffect(() => {
    if (!searchRecipients) return;
    const query = draft.trim();
    if (query.length < 2 || EMAIL_PATTERN.test(query)) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchRecipients(query, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          const chosen = new Set(value.map((entry) => entry.toLowerCase()));
          setSuggestions(results.filter((entry) => !chosen.has(entry.email.toLowerCase())).slice(0, 5));
        })
        .catch(() => setSuggestions([]));
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, searchRecipients, value]);

  return (
    <View style={{ marginTop: spacing.xs }} testID={testID}>
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>{label}</Text>
      {value.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: 4 }}>
          {value.map((entry) => (
            <Pressable
              key={entry}
              testID={`${testID}-chip-${entry}`}
              accessibilityRole="button"
              onPress={() => onChange(value.filter((item) => item !== entry))}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 999,
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
              }}
            >
              <Text style={{ ...typography.caption, color: colors.text }}>{entry}</Text>
              <Feather name="x" size={12} color={colors.textSecondary} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput
        testID={`${testID}-input`}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder={t("comments.recipientPlaceholder")}
        placeholderTextColor={colors.textSecondary}
        style={{
          marginTop: 4,
          borderWidth: 1,
          borderColor: invalid.length > 0 ? colors.danger : colors.border,
          borderRadius: 8,
          paddingHorizontal: spacing.sm,
          paddingVertical: 6,
          color: colors.text,
        }}
      />
      {suggestions.length > 0 ? (
        <View
          testID={`${testID}-suggestions`}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: 4 }}
        >
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.email}
              testID={`${testID}-suggestion-${suggestion.email}`}
              accessibilityRole="button"
              onPress={() => {
                add([suggestion.email]);
                setDraft("");
                setInvalid([]);
                setSuggestions([]);
              }}
              style={{ paddingHorizontal: spacing.sm, paddingVertical: 6 }}
            >
              <Text style={{ ...typography.caption, color: colors.text }}>
                {suggestion.name ? `${suggestion.name} <${suggestion.email}>` : suggestion.email}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {invalid.length > 0 ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: 2 }}>
          {t("comments.recipientInvalid", { entries: invalid.join(", ") })}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Expandable Cc/Bcc section for the mobile comment composer. Hidden for an
 * internal note: those never email anyone outside the MSP, and the API rejects
 * the fields.
 */
export function CommentEmailRecipients({
  isInternal,
  cc,
  bcc,
  onChangeCc,
  onChangeBcc,
  searchRecipients,
}: {
  isInternal: boolean;
  cc: string[];
  bcc: string[];
  onChangeCc: (next: string[]) => void;
  onChangeBcc: (next: string[]) => void;
  /** Contact lookup for the suggestion list; omitted leaves free text only. */
  searchRecipients?: CommentRecipientSearch;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const [expanded, setExpanded] = useState(false);

  if (isInternal) return null;

  const count = cc.length + bcc.length;

  return (
    <View style={{ marginTop: spacing.sm }}>
      <Pressable
        testID="comment-cc-bcc-toggle"
        accessibilityRole="button"
        onPress={() => setExpanded((value) => !value)}
        style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
      >
        <Feather name={expanded ? "chevron-down" : "chevron-right"} size={14} color={colors.primary} />
        <Text style={{ ...typography.caption, color: colors.primary }}>
          {count > 0 && !expanded ? t("comments.ccBccCount", { count }) : t("comments.ccBcc")}
        </Text>
      </Pressable>
      {expanded ? (
        <>
          <RecipientRow testID="comment-cc" label={t("comments.cc")} value={cc} onChange={onChangeCc} searchRecipients={searchRecipients} />
          <RecipientRow testID="comment-bcc" label={t("comments.bcc")} value={bcc} onChange={onChangeBcc} searchRecipients={searchRecipients} />
        </>
      ) : null}
    </View>
  );
}

/** The muted `Cc: …` / `Bcc: …` lines under a comment in the list. */
export function CommentEmailRecipientLines({
  emailRecipients,
}: {
  emailRecipients?: {
    cc?: Array<{ email: string; name?: string }>;
    bcc?: Array<{ email: string; name?: string }>;
  } | null;
}) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const describe = (entry: { email: string; name?: string }) => entry.name || entry.email;
  const cc = emailRecipients?.cc ?? [];
  const bcc = emailRecipients?.bcc ?? [];
  if (cc.length === 0 && bcc.length === 0) return null;

  return (
    <View testID="comment-email-recipients">
      {cc.length > 0 ? (
        <Text style={{ ...typography.caption, color: colors.textSecondary }}>
          {t("comments.cc")}: {cc.map(describe).join(", ")}
        </Text>
      ) : null}
      {bcc.length > 0 ? (
        <Text style={{ ...typography.caption, color: colors.textSecondary }}>
          {t("comments.bcc")}: {bcc.map(describe).join(", ")}
        </Text>
      ) : null}
    </View>
  );
}
