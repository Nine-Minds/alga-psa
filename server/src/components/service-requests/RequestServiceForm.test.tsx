/** @vitest-environment jsdom */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { RequestServiceForm } from "./RequestServiceForm";
import { CLIENT_SUBMISSION_KEY_FIELD_NAME } from "./clientSubmissionKey";

describe("RequestServiceForm long-text fields", () => {
  afterEach(() => cleanup());

  it("submits typed and defaulted answers through FormData and exposes required validity", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <RequestServiceForm
        action={action}
        fields={[
          { key: "details", type: "long-text", label: "Details" },
          { key: "context", type: "long-text", label: "Context" },
          { key: "reason", type: "long-text", label: "Reason", required: true },
        ]}
        initialValues={{ context: "Initial context", reason: "Initial reason" }}
        labels={{
          selectPlaceholder: "Select",
          datePlaceholder: "Date",
          submit: "Submit request",
          requiredField: "This field is required.",
        }}
        clientSubmissionKey="attempt-1"
      />,
    );

    const details = screen.getByRole("textbox", { name: "Details" });
    const context = screen.getByRole("textbox", { name: "Context" });
    const reason = screen.getByRole("textbox", { name: "Reason *" });
    expect(details).toHaveValue("");
    expect(context).toHaveValue("Initial context");
    expect(reason).toHaveValue("Initial reason");
    await user.type(details, "Typed details");
    await user.type(context, " edited");
    await user.type(reason, " appended");
    expect(details).toHaveValue("Typed details");
    expect(context).toHaveValue("Initial context edited");
    expect(reason).toHaveValue("Initial reason appended");

    const form = details.closest("form")!;
    expect(form.noValidate).toBe(true);
    expect((reason as HTMLTextAreaElement).required).toBe(true);
    await user.clear(reason);
    expect(form.checkValidity()).toBe(false);
    await user.type(reason, "Edited required answer");
    expect(form.checkValidity()).toBe(true);

    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(action).toHaveBeenCalledTimes(1);
    const submittedData = action.mock.calls[0][0] as FormData;
    expect(submittedData.get("details")).toBe("Typed details");
    expect(submittedData.get("context")).toBe("Initial context edited");
    expect(submittedData.get("reason")).toBe("Edited required answer");
    expect(submittedData.get(CLIENT_SUBMISSION_KEY_FIELD_NAME)).toBe(
      "attempt-1",
    );
  });

  it("allows an optional defaulted long-text answer to be cleared and submitted empty", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <RequestServiceForm
        action={action}
        fields={[{ key: "notes", type: "long-text", label: "Notes" }]}
        initialValues={{ notes: "Default notes" }}
        labels={{
          selectPlaceholder: "Select",
          datePlaceholder: "Date",
          submit: "Submit request",
          requiredField: "This field is required.",
        }}
        clientSubmissionKey="attempt-2"
      />,
    );

    const notes = screen.getByRole("textbox", { name: "Notes" });
    expect(notes).toHaveValue("Default notes");
    await user.clear(notes);
    expect(notes).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(action).toHaveBeenCalledTimes(1);
    const submittedData = action.mock.calls[0][0] as FormData;
    expect(submittedData.get("notes")).toBe("");
  });
});

const vpnReason = () => document.getElementById("request-service-field-vpn_reason");

describe("RequestServiceForm live conditional visibility", () => {
  afterEach(() => cleanup());

  const labels = {
    selectPlaceholder: "Select",
    datePlaceholder: "Date",
    submit: "Submit request",
    requiredField: "This field is required.",
  };
  const visibility = {
    enabled: true,
    rules: [{ fieldKey: "vpn_reason", source: "needs_vpn", operator: "is-true" as const }],
    context: { requesterUserId: "user-1", clientId: "client-1", contactId: null },
  };
  const fields = [
    { key: "needs_vpn", type: "checkbox", label: "Needs VPN" },
    { key: "vpn_reason", type: "short-text", label: "VPN Reason", required: true },
  ];

  it("mounts and unmounts the dependent field as soon as the controller changes", async () => {
    const user = userEvent.setup();
    render(
      <RequestServiceForm
        action={vi.fn()}
        fields={fields}
        initialValues={{}}
        visibility={visibility}
        labels={labels}
        clientSubmissionKey="k"
      />,
    );
    expect(vpnReason()).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Needs VPN" }));
    expect(vpnReason()).not.toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Needs VPN" }));
    expect(vpnReason()).toBeNull();
  });

  it("omits hidden keys from FormData and does not enforce hidden required fields", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <RequestServiceForm
        action={action}
        fields={fields}
        initialValues={{}}
        visibility={visibility}
        labels={labels}
        clientSubmissionKey="k"
      />,
    );
    const form = screen.getByRole("button", { name: "Submit request" }).closest("form")!;
    expect(form.checkValidity()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    const data = action.mock.calls[0][0] as FormData;
    expect(data.has("vpn_reason")).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "Needs VPN" }));
    expect(form.checkValidity()).toBe(false);
    await user.type(vpnReason()!, "Remote");
    expect(form.checkValidity()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect((action.mock.calls[1][0] as FormData).get("vpn_reason")).toBe("Remote");
  });

  it("renders every field when visibility is disabled", () => {
    render(
      <RequestServiceForm
        action={vi.fn()}
        fields={fields}
        initialValues={{}}
        visibility={{ ...visibility, enabled: false }}
        labels={labels}
        clientSubmissionKey="k"
      />,
    );
    expect(vpnReason()).not.toBeNull();
  });

  it("blocks submit on a revealed, empty required field and keeps the client's answers", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <RequestServiceForm
        action={action}
        fields={[{ key: "summary", type: "short-text", label: "Summary" }, ...fields]}
        initialValues={{}}
        visibility={visibility}
        labels={labels}
        clientSubmissionKey="k"
      />,
    );
    await user.type(document.getElementById("request-service-field-summary")!, "New starter");
    await user.click(screen.getByRole("checkbox", { name: "Needs VPN" }));
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("This field is required.");
    expect(vpnReason()).toHaveFocus();
    expect(document.getElementById("request-service-field-summary")!).toHaveValue("New starter");
    expect(screen.getByRole("checkbox", { name: "Needs VPN" })).toBeChecked();

    await user.type(vpnReason()!, "Remote");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect((action.mock.calls[0][0] as FormData).get("vpn_reason")).toBe("Remote");
  });

  it("does not treat an unchecked required checkbox as missing (matches the server)", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <RequestServiceForm
        action={action}
        fields={[{ key: "agree", type: "checkbox", label: "Agree", required: true }]}
        initialValues={{}}
        labels={labels}
        clientSubmissionKey="k"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
