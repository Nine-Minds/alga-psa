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
          { key: "reason", type: "long-text", label: "Reason", required: true },
        ]}
        initialValues={{ reason: "Initial reason" }}
        labels={{
          selectPlaceholder: "Select",
          datePlaceholder: "Date",
          submit: "Submit request",
        }}
        clientSubmissionKey="attempt-1"
      />,
    );

    const details = screen.getByRole("textbox", { name: "Details" });
    const reason = screen.getByRole("textbox", { name: "Reason *" });
    expect(details).toHaveValue("");
    expect(reason).toHaveValue("Initial reason");
    await user.type(details, "Typed details");
    await user.type(reason, " appended");
    expect(details).toHaveValue("Typed details");
    expect(reason).toHaveValue("Initial reason appended");

    const form = details.closest("form")!;
    expect(form.noValidate).toBe(true);
    expect((reason as HTMLTextAreaElement).required).toBe(true);
    await user.clear(reason);
    expect(form.checkValidity()).toBe(false);
    await user.type(reason, "Required answer");
    expect(form.checkValidity()).toBe(true);

    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(action).toHaveBeenCalledTimes(1);
    const submittedData = action.mock.calls[0][0] as FormData;
    expect(submittedData.get("details")).toBe("Typed details");
    expect(submittedData.get("reason")).toBe("Required answer");
    expect(submittedData.get(CLIENT_SUBMISSION_KEY_FIELD_NAME)).toBe(
      "attempt-1",
    );
  });
});
