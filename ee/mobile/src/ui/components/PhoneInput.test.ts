import { describe, expect, it } from "vitest";
import { formatPhoneAsYouType } from "./PhoneInput";

describe("formatPhoneAsYouType", () => {
  it("formats a national number in the default country as it is typed", () => {
    expect(formatPhoneAsYouType("", "3202521658", "US")).toBe("(320) 252-1658");
    expect(formatPhoneAsYouType("(320) 25", "(320) 252", "US")).toBe("(320) 252");
  });

  it("lets a + prefix pick its own country", () => {
    expect(formatPhoneAsYouType("", "+442079460958", "US")).toBe("+44 20 7946 0958");
  });

  it("leaves deletions alone so the caret is not fought", () => {
    expect(formatPhoneAsYouType("(320) 252-1658", "(320) 252-165", "US")).toBe("(320) 252-165");
  });

  it("passes through text with no digits and tolerates an unknown country", () => {
    expect(formatPhoneAsYouType("", "abc", "US")).toBe("abc");
    expect(formatPhoneAsYouType("", "3202521658", "XX")).toBeTruthy();
  });
});
