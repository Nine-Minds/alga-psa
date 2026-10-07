/** @vitest-environment jsdom */

import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { TextArea } from "./TextArea";

vi.mock("../ui-reflection/useAutomationIdAndRegister", () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

describe("TextArea", () => {
  afterEach(() => cleanup());

  it("accepts typing when uncontrolled without an initial value", async () => {
    const user = userEvent.setup();
    render(<TextArea aria-label="Answer" />);
    const field = screen.getByRole("textbox", { name: "Answer" });
    await user.type(field, "A typed answer");
    expect(field).toHaveValue("A typed answer");
  });

  it("accepts edits to an uncontrolled defaultValue without a controlled/uncontrolled warning", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(<TextArea aria-label="Answer" defaultValue="Initial" />);
    const field = screen.getByRole("textbox", { name: "Answer" });
    expect(field).toHaveValue("Initial");
    await user.type(field, " answer");
    expect(field).toHaveValue("Initial answer");
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("both value and defaultValue"),
    );
    consoleError.mockRestore();
  });

  it("forwards changes and keeps the registered uncontrolled field editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TextArea
        aria-label="Registered answer"
        onChange={onChange}
        name="content"
      />,
    );
    const field = screen.getByRole("textbox", { name: "Registered answer" });
    await user.type(field, "Content");
    expect(field).toHaveValue("Content");
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall?.[0].target.value).toBe("Content");
  });

  it("updates a controlled value through its change callback", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <TextArea
          aria-label="Controlled"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    render(<Harness />);
    const field = screen.getByRole("textbox", { name: "Controlled" });
    await user.type(field, "Controlled text");
    expect(field).toHaveValue("Controlled text");
  });

  it("keeps a controlled value fixed when its callback does not update it", async () => {
    const user = userEvent.setup();
    render(<TextArea aria-label="Fixed" value="fixed" onChange={() => {}} />);
    const field = screen.getByRole("textbox", { name: "Fixed" });
    await user.type(field, " text");
    expect(field).toHaveValue("fixed");
  });

  it("treats value={undefined} as controlled and forwards the textarea ref", () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { rerender } = render(
      <TextArea
        aria-label="Optional controlled"
        value={undefined}
        ref={ref}
        onChange={() => {}}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Optional controlled" });
    expect(field).toHaveValue("");
    expect(ref.current).toBe(field);
    rerender(
      <TextArea
        aria-label="Optional controlled"
        value="now set"
        ref={ref}
        onChange={() => {}}
      />,
    );
    expect(field).toHaveValue("now set");
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("uncontrolled input to be controlled"),
    );
    consoleError.mockRestore();
  });
});
