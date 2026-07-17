/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TicketResolutionDialog from "./TicketResolutionDialog";

const DEFAULT_BLOCK = [
  {
    type: "paragraph",
    props: {
      textAlignment: "left",
      backgroundColor: "default",
      textColor: "default",
    },
    content: [{ type: "text", text: "", styles: {} }],
  },
];

const uploadSessionMock = vi.hoisted(() => ({
  deleteTrackedDraftClipboardImages: vi.fn(),
  isDeletingDraftImages: false,
  keepDraftClipboardImages: vi.fn(),
  requestDiscard: vi.fn(),
  resetDraftTracking: vi.fn(),
  setShowDraftCancelDialog: vi.fn(),
  showDraftCancelDialog: false,
  uploadFile: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockTextEditor({
      initialContent,
      onContentChange,
    }: {
      initialContent: typeof DEFAULT_BLOCK;
      onContentChange: (blocks: typeof DEFAULT_BLOCK) => void;
    }) {
      const [value, setValue] = React.useState(
        initialContent[0]?.content[0]?.text ?? "",
      );

      return (
        <textarea
          aria-label="Resolution"
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);
            onContentChange(
              nextValue
                ? [
                    {
                      ...DEFAULT_BLOCK[0],
                      content: [{ type: "text", text: nextValue, styles: {} }],
                    },
                  ]
                : DEFAULT_BLOCK,
            );
          }}
        />
      );
    },
}));

vi.mock("@alga-psa/ui/editor", () => ({ TextEditor: vi.fn() }));

vi.mock("@alga-psa/user-composition/actions", () => ({
  searchUsersForMentions: vi.fn(),
}));

vi.mock("./TicketConversation", () => ({
  DEFAULT_BLOCK: [
    {
      type: "paragraph",
      props: {
        textAlignment: "left",
        backgroundColor: "default",
        textColor: "default",
      },
      content: [{ type: "text", text: "", styles: {} }],
    },
  ],
}));

vi.mock("./useTicketRichTextUploadSession", () => ({
  useTicketRichTextUploadSession: () => uploadSessionMock,
}));

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@alga-psa/ui/components/CustomSelect", () => ({
  default: ({
    id,
    label,
    value,
    options,
    onValueChange,
    disabled,
  }: {
    id: string;
    label: string;
    value: string | null;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">Select a close status</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

describe("TicketResolutionDialog", () => {
  it("requires a close status and non-empty resolution, then submits blocks and suppression", async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);

    render(
      <TicketResolutionDialog
        id="ticket-resolution-close"
        isOpen
        ticketId="ticket-1"
        statusOptions={[
          { value: "resolved", label: "Resolved" },
          { value: "closed", label: "Closed" },
        ]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    uploadSessionMock.resetDraftTracking.mockClear();

    expect(
      screen.getByText(
        "Choose a close status and add a resolution for this ticket.",
      ),
    ).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Resolve and close" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Resolution"), {
      target: { value: "  Replaced the failed switch.  " },
    });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Close status"), {
      target: { value: "resolved" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith(
      "resolved",
      [
        {
          ...DEFAULT_BLOCK[0],
          content: [
            {
              type: "text",
              text: "  Replaced the failed switch.  ",
              styles: {},
            },
          ],
        },
      ],
      {
        suppressContactNotifications: false,
        suppressInternalNotifications: false,
      },
    );
    await waitFor(() => {
      expect(uploadSessionMock.resetDraftTracking).toHaveBeenCalledOnce();
    });
  });

  it("keeps draft image tracking until the async resolution save succeeds", async () => {
    let finishSave: ((saved: boolean) => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
    );

    render(
      <TicketResolutionDialog
        id="ticket-resolution-close"
        isOpen
        ticketId="ticket-1"
        statusOptions={[{ value: "closed", label: "Closed" }]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    uploadSessionMock.resetDraftTracking.mockClear();

    fireEvent.change(screen.getByLabelText("Resolution"), {
      target: { value: "Resolved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve and close" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(uploadSessionMock.resetDraftTracking).not.toHaveBeenCalled();

    finishSave?.(true);
    await waitFor(() => {
      expect(uploadSessionMock.resetDraftTracking).toHaveBeenCalledOnce();
    });
  });

  it("keeps uploaded images tracked when the resolution save fails", async () => {
    const onConfirm = vi.fn().mockResolvedValue(false);

    render(
      <TicketResolutionDialog
        id="ticket-resolution-close"
        isOpen
        ticketId="ticket-1"
        statusOptions={[{ value: "closed", label: "Closed" }]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    uploadSessionMock.resetDraftTracking.mockClear();

    fireEvent.change(screen.getByLabelText("Resolution"), {
      target: { value: "Resolved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve and close" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(uploadSessionMock.resetDraftTracking).not.toHaveBeenCalled();
  });

  it("resets the draft, status choice, and suppression whenever the dialog is opened again", () => {
    const props = {
      id: "ticket-resolution-close",
      ticketId: "ticket-1",
      statusOptions: [
        { value: "resolved", label: "Resolved" },
        { value: "closed", label: "Closed" },
      ],
      onClose: vi.fn(),
      onConfirm: vi.fn().mockResolvedValue(true),
    };
    const { rerender } = render(<TicketResolutionDialog {...props} isOpen />);

    fireEvent.change(screen.getByLabelText("Close status"), {
      target: { value: "closed" },
    });
    fireEvent.change(screen.getByLabelText("Resolution"), {
      target: { value: "Temporary draft" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Don't notify the customer" }),
    );
    rerender(<TicketResolutionDialog {...props} isOpen={false} />);
    rerender(<TicketResolutionDialog {...props} isOpen />);

    expect(screen.getByLabelText("Close status")).toHaveValue("");
    expect(screen.getByLabelText("Resolution")).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: "Don't notify the customer" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Also don't notify agents and watchers",
      }),
    ).not.toBeChecked();
  });

  it("preselects the only available close status", () => {
    render(
      <TicketResolutionDialog
        id="ticket-resolution-close"
        isOpen
        ticketId="ticket-1"
        statusOptions={[{ value: "closed", label: "Closed" }]}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.getByLabelText("Close status")).toHaveValue("closed");
  });

  it("submits contact and internal notification suppression", () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    render(
      <TicketResolutionDialog
        id="ticket-resolution-close"
        isOpen
        ticketId="ticket-1"
        statusOptions={[{ value: "closed", label: "Closed" }]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const contactSuppression = screen.getByRole("checkbox", {
      name: "Don't notify the customer",
    });
    const internalSuppression = screen.getByRole("checkbox", {
      name: "Also don't notify agents and watchers",
    });
    expect(contactSuppression).not.toBeChecked();
    expect(internalSuppression).toBeDisabled();

    fireEvent.click(contactSuppression);
    expect(internalSuppression).toBeEnabled();
    fireEvent.click(internalSuppression);
    fireEvent.change(screen.getByLabelText("Resolution"), {
      target: { value: "Resolved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve and close" }));

    expect(onConfirm).toHaveBeenCalledWith("closed", expect.any(Array), {
      suppressContactNotifications: true,
      suppressInternalNotifications: true,
    });
  });
});
