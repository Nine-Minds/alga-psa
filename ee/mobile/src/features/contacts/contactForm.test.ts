import { describe, expect, it } from "vitest";
import type { ContactDetail } from "../../api/contacts";
import {
  buildContactCreatePayload,
  buildContactUpdatePayload,
  buildPhonePayload,
  contactFormFromDetail,
  emptyContactForm,
  emptyEmailRow,
  emptyPhoneRow,
  hasContactErrors,
  validateContactForm,
} from "./contactForm";

// i18next-shaped translate: fall back to the message's own default wording.
const t = (key: string, options?: Record<string, unknown>) => {
  const template = typeof options?.defaultValue === "string" ? options.defaultValue : key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (options && name in options ? String(options[name]) : match));
};

const detail: ContactDetail = {
  contact_name_id: "contact-1",
  full_name: "Jane Doe",
  email: "jane@acme.test",
  primary_email_canonical_type: "work",
  client_id: "client-1",
  client_name: "Acme",
  role: "CTO",
  notes: null,
  is_inactive: false,
  tags: ["vip"],
  phone_numbers: [
    { contact_phone_number_id: "p1", phone_number: "+13202521658", extension: null, canonical_type: "mobile", is_default: true, display_order: 0 },
    { contact_phone_number_id: "p2", phone_number: "+442079460958", extension: "12", canonical_type: null, custom_type: "Pager", is_default: false, display_order: 1 },
  ],
  additional_email_addresses: [{ contact_additional_email_address_id: "e1", email_address: "jd@personal.test", canonical_type: "personal" }],
};

describe("contact form", () => {
  it("starts attached to the preset client with one empty phone row", () => {
    const values = emptyContactForm({ id: "client-1", name: "Acme" });
    expect(values.clientId).toBe("client-1");
    expect(values.phones).toEqual([emptyPhoneRow()]);
    expect(values.additionalEmails).toEqual([]);
  });

  it("loads phone and email rows from the contact, keeping ids, custom labels and the default flag", () => {
    const values = contactFormFromDetail(detail);
    expect(values.phones).toEqual([
      { id: "p1", number: "+13202521658", extension: "", type: "mobile", customType: "", isDefault: true },
      { id: "p2", number: "+442079460958", extension: "12", type: "custom", customType: "Pager", isDefault: false },
    ]);
    expect(values.additionalEmails).toEqual([{ id: "e1", address: "jd@personal.test", type: "personal", customType: "" }]);
    expect(values.tags).toEqual(["vip"]);
  });

  it("requires name and email and flags unparseable phone rows with the web's wording", () => {
    const values = { ...emptyContactForm(null), phones: [{ ...emptyPhoneRow(), number: "abc" }, { ...emptyPhoneRow(), number: "320 252 1658", extension: "x1" }, { ...emptyPhoneRow("custom"), number: "320 252 1658" }] };
    const { errors } = validateContactForm(values, t, "US");
    expect(errors.fullName).toBe("Full name is required.");
    expect(errors.email).toBe("Email address is required");
    expect(errors.phones).toEqual({ 0: "Please enter a valid phone number", 1: "Please enter a valid phone extension", 2: "Enter a label for the custom type." });
    expect(validateContactForm({ ...values, email: "nope" }, t, "US").errors.email).toBe("Please enter a valid email address");
    const clean = validateContactForm({ ...values, fullName: "Jane", email: "jane@acme.test", phones: [] }, t, "US");
    expect(hasContactErrors(clean)).toBe(false);
  });

  it("applies the web's additional-email rules", () => {
    const values = {
      ...emptyContactForm(null),
      fullName: "Jane",
      email: "jane@acme.test",
      additionalEmails: [
        { ...emptyEmailRow(), address: "Jane@Acme.test" },
        { ...emptyEmailRow(), address: "jd@personal.test" },
        { ...emptyEmailRow(), address: "jd@personal.test" },
        { ...emptyEmailRow(), address: "bad" },
      ],
    };
    const { errors } = validateContactForm(values, t, "US");
    expect(errors.additionalEmails).toEqual({
      0: "Additional email cannot match the primary email.",
      2: "Additional email addresses must be unique.",
      3: "Please enter a valid email address",
    });
  });

  it("surfaces plausibility warnings from the shared advise layer without blocking", () => {
    const check = validateContactForm({ ...emptyContactForm(null), fullName: "test", email: "jane@example.com", phones: [] }, t, "US");
    expect(hasContactErrors(check)).toBe(false);
    expect(check.warnings.fullName).toBe("This looks like a placeholder rather than a person.");
    expect(check.warnings.email).toBe("example.com is reserved for documentation and testing.");
  });

  it("drops empty rows, normalizes numbers, carries custom labels, and defaults the first row when none is marked", () => {
    const values = {
      ...emptyContactForm(null),
      phones: [emptyPhoneRow(), { ...emptyPhoneRow("work"), number: "(320) 252-1658", extension: "42" }, { ...emptyPhoneRow("custom"), number: "+44 20 7946 0958", customType: "Pager" }],
    };
    expect(buildPhonePayload(values, "US")).toEqual([
      { phone_number: "+13202521658", extension: "42", canonical_type: "work", custom_type: null, is_default: true, display_order: 0 },
      { phone_number: "+442079460958", canonical_type: null, custom_type: "Pager", is_default: false, display_order: 1 },
    ]);
  });

  it("builds a strict create payload", () => {
    const values = {
      ...emptyContactForm({ id: "client-1", name: "Acme" }),
      fullName: " Jane ",
      email: " Jane@Acme.test",
      role: "",
      notes: "VIP",
      tags: ["vip"],
      additionalEmails: [{ ...emptyEmailRow("custom"), address: "JD@Personal.test", customType: "School" }],
    };
    expect(buildContactCreatePayload(values, "US")).toEqual({
      full_name: "Jane",
      email: "jane@acme.test",
      client_id: "client-1",
      notes: "VIP",
      tags: ["vip"],
      phone_numbers: [],
      additional_email_addresses: [{ email_address: "jd@personal.test", canonical_type: null, custom_type: "School", display_order: 0 }],
    });
  });

  it("sends nothing for an untouched contact, even one with custom-typed rows", () => {
    expect(buildContactUpdatePayload(contactFormFromDetail(detail), detail, "US")).toEqual({});
  });

  it("demotes the old primary email alongside the new one, as the server requires", () => {
    const values = { ...contactFormFromDetail(detail), email: "jane.doe@acme.test" };
    expect(buildContactUpdatePayload(values, detail, "US")).toEqual({
      email: "jane.doe@acme.test",
      primary_email_canonical_type: "work",
      additional_email_addresses: [
        { contact_additional_email_address_id: "e1", email_address: "jd@personal.test", canonical_type: "personal", custom_type: null, display_order: 0 },
        { email_address: "jane@acme.test", canonical_type: "work", custom_type: null, display_order: 1 },
      ],
    });
  });

  it("keeps a custom primary email label when the primary changes", () => {
    const custom = { ...detail, primary_email_canonical_type: null, primary_email_type: "School" } as ContactDetail;
    const payload = buildContactUpdatePayload({ ...contactFormFromDetail(custom), email: "new@acme.test" }, custom, "US");
    expect(payload.primary_email_canonical_type).toBeNull();
    expect(payload.primary_email_custom_type).toBe("School");
    expect(payload.additional_email_addresses?.at(-1)).toEqual({ email_address: "jane@acme.test", canonical_type: null, custom_type: "School", display_order: 1 });
  });

  it("replaces the phone list when a row changes and keeps existing ids and custom labels", () => {
    const values = contactFormFromDetail(detail);
    values.phones = [{ ...values.phones[0], isDefault: false }, { ...values.phones[1], isDefault: true }];
    const payload = buildContactUpdatePayload({ ...values, role: "CEO", tags: ["vip", "exec"] }, detail, "US");
    expect(payload.role).toBe("CEO");
    expect(payload.tags).toEqual(["vip", "exec"]);
    expect(payload.phone_numbers).toEqual([
      { contact_phone_number_id: "p1", phone_number: "+13202521658", canonical_type: "mobile", custom_type: null, is_default: false, display_order: 0 },
      { contact_phone_number_id: "p2", phone_number: "+442079460958", extension: "12", canonical_type: null, custom_type: "Pager", is_default: true, display_order: 1 },
    ]);
  });

  it("replaces additional emails when a row is added without touching the primary", () => {
    const values = contactFormFromDetail(detail);
    values.additionalEmails = [...values.additionalEmails, { ...emptyEmailRow("billing"), address: "ap@acme.test" }];
    const payload = buildContactUpdatePayload(values, detail, "US");
    expect(payload.email).toBeUndefined();
    expect(payload.additional_email_addresses).toEqual([
      { contact_additional_email_address_id: "e1", email_address: "jd@personal.test", canonical_type: "personal", custom_type: null, display_order: 0 },
      { email_address: "ap@acme.test", canonical_type: "billing", custom_type: null, display_order: 1 },
    ]);
  });
});
