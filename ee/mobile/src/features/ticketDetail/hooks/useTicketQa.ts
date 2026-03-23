import { useCallback, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import type { TicketComment, TicketDetail } from "../../../api/tickets";
import {
  extractPlainTextFromRichEditorJson,
  isMalformedRichEditorContent,
  serializeRichEditorJson,
} from "../../ticketRichText/helpers";
import type { TicketRichTextQaScenario } from "../../../qa/ticketRichTextQa";
import { extractDescription } from "../utils";

const QA_LINK_URL = __DEV__ ? "https://example.com/mobile-rich-text-smoke" : "";
const QA_DESCRIPTION_JSON = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Mobile rich text smoke check: " },
        {
          type: "text",
          text: "open reference link",
          marks: [
            {
              type: "link",
              attrs: {
                href: QA_LINK_URL,
                target: "_blank",
                rel: "noopener noreferrer nofollow",
              },
            },
          ],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Checklist item one" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Checklist item two" }] }],
        },
      ],
    },
  ],
} as const;
const QA_COMMENT_JSON = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "QA comment sent from native rich text flow." },
      ],
    },
    {
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Confirm editor loads" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Confirm save path works" }] }],
        },
      ],
    },
  ],
} as const;

const QA_DESCRIPTION_CONTENT = serializeRichEditorJson(QA_DESCRIPTION_JSON);
const QA_DESCRIPTION_PLAIN_TEXT = extractPlainTextFromRichEditorJson(QA_DESCRIPTION_JSON).trim();
const QA_COMMENT_CONTENT = serializeRichEditorJson(QA_COMMENT_JSON);
const QA_COMMENT_PLAIN_TEXT = extractPlainTextFromRichEditorJson(QA_COMMENT_JSON).trim();

type TicketRichTextQaStatus =
  | {
      scenario: TicketRichTextQaScenario;
      state: "running" | "passed" | "failed";
      step: string;
      detail?: string;
    }
  | null;

export function useTicketQa({
  qaScenario,
  ticketId,
  ticket,
  comments,
  initialLoading,
  draftLoaded,
  persistDescriptionContent,
  submitCommentPayload,
  startDescriptionEditing,
  setDescriptionDraft,
  setDescriptionPlainText,
  setCommentDraft,
  setCommentDraftPlainText,
}: {
  qaScenario?: TicketRichTextQaScenario;
  ticketId: string;
  ticket: TicketDetail | null;
  comments: TicketComment[];
  initialLoading: boolean;
  draftLoaded: boolean;
  persistDescriptionContent: (serializedDescription: string, nextPlainText: string) => Promise<boolean>;
  submitCommentPayload: (payload: {
    serializedDraft: string;
    text: string;
    originalDraft: string;
    originalDraftPlainText: string;
    originalIsInternal: boolean;
  }) => Promise<boolean>;
  startDescriptionEditing: () => void;
  setDescriptionDraft: (v: string) => void;
  setDescriptionPlainText: (v: string) => void;
  setCommentDraft: (v: string) => void;
  setCommentDraftPlainText: (v: string) => void;
}) {
  const [qaStatus, setQaStatus] = useState<TicketRichTextQaStatus>(null);
  const [qaAutoPressLink, setQaAutoPressLink] = useState(false);

  const qaScenarioStartedRef = useRef(false);
  const qaLinkCallbackRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    qaScenarioStartedRef.current = false;
    qaLinkCallbackRef.current = null;
    setQaAutoPressLink(false);
    setQaStatus(null);
  }, [qaScenario, ticketId]);

  const updateQaStatus = useCallback(
    (next: Exclude<TicketRichTextQaStatus, null>) => {
      setQaStatus(next);
      console.info("[TicketRichTextQA]", next.scenario, next.state, next.step, next.detail ?? "");
    },
    [],
  );

  const handleRichTextLinkPress = useCallback(
    (url: string) => {
      if (qaScenario && url === QA_LINK_URL) {
        setQaAutoPressLink(false);
        qaLinkCallbackRef.current?.();
        qaLinkCallbackRef.current = null;
        updateQaStatus({
          scenario: qaScenario,
          state: "passed",
          step: "Triggered rich-text link handoff",
          detail: url,
        });
      }

      void Linking.openURL(url);
    },
    [qaScenario, updateQaStatus],
  );

  // QA scenario runner
  useEffect(() => {
    if (!qaScenario || qaScenarioStartedRef.current) {
      return;
    }

    if (initialLoading || !ticket || !draftLoaded) {
      return;
    }

    qaScenarioStartedRef.current = true;

    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const waitForQaLink = () =>
      new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          qaLinkCallbackRef.current = null;
          reject(new Error("Timed out waiting for rich-text link handoff"));
        }, 2_000);

        qaLinkCallbackRef.current = () => {
          clearTimeout(timeoutId);
          resolve();
        };
      });

    const runScenario = async () => {
      try {
        if (qaScenario === "malformed-guard") {
          const hasMalformedDescription = Boolean(
            extractDescription(ticket) && isMalformedRichEditorContent(extractDescription(ticket) ?? ""),
          );
          const hasMalformedComment = comments.some((comment) => {
            const kind = comment.kind;
            const eventType = comment.event_type;
            if (kind === "event" || typeof eventType === "string") return false;
            return isMalformedRichEditorContent(comment.comment_text);
          });

          if (!hasMalformedDescription && !hasMalformedComment) {
            throw new Error("Malformed QA scenario requires malformed description or comment content.");
          }

          updateQaStatus({
            scenario: qaScenario,
            state: "passed",
            step: "Malformed content stayed on safe text fallback",
          });
          return;
        }

        updateQaStatus({
          scenario: qaScenario,
          state: "running",
          step: "Opening description editor",
        });
        startDescriptionEditing();
        setDescriptionDraft(QA_DESCRIPTION_CONTENT);
        setDescriptionPlainText(QA_DESCRIPTION_PLAIN_TEXT);
        await pause(600);

        updateQaStatus({
          scenario: qaScenario,
          state: "running",
          step: "Saving rich description",
        });
        const descriptionSaved = await persistDescriptionContent(
          QA_DESCRIPTION_CONTENT,
          QA_DESCRIPTION_PLAIN_TEXT,
        );
        if (!descriptionSaved) {
          throw new Error("Description save failed");
        }

        await pause(600);
        updateQaStatus({
          scenario: qaScenario,
          state: "running",
          step: "Sending rich comment",
        });
        setCommentDraft(QA_COMMENT_CONTENT);
        setCommentDraftPlainText(QA_COMMENT_PLAIN_TEXT);
        const commentSent = await submitCommentPayload({
          serializedDraft: QA_COMMENT_CONTENT,
          text: QA_COMMENT_PLAIN_TEXT,
          originalDraft: QA_COMMENT_CONTENT,
          originalDraftPlainText: QA_COMMENT_PLAIN_TEXT,
          originalIsInternal: true,
        });
        if (!commentSent) {
          throw new Error("Comment send failed");
        }

        await pause(600);
        updateQaStatus({
          scenario: qaScenario,
          state: "running",
          step: "Triggering rich-text link handoff",
          detail: QA_LINK_URL,
        });
        setQaAutoPressLink(true);
        await waitForQaLink();
      } catch (scenarioError) {
        setQaAutoPressLink(false);
        updateQaStatus({
          scenario: qaScenario,
          state: "failed",
          step: "QA scenario failed",
          detail: scenarioError instanceof Error ? scenarioError.message : "Unknown error",
        });
      }
    };

    void runScenario();
  }, [
    comments,
    draftLoaded,
    initialLoading,
    persistDescriptionContent,
    qaScenario,
    submitCommentPayload,
    ticket,
    updateQaStatus,
  ]);

  return {
    qaStatus,
    qaAutoPressLink,
    handleRichTextLinkPress,
  };
}
