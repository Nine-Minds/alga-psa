import { describe, expect, it } from "vitest";
import type { ClientDetail, ClientLocation } from "../../api/clients";
import type { Country } from "../../api/countries";
import {
  buildClientCreatePayload,
  buildClientUpdatePayload,
  buildLocationPayload,
  clientFormFromDetail,
  defaultClientLocation,
  emptyClientForm,
  hasBlockingErrors,
  hasLocationData,
  recheckField,
  validateClientForm,
} from "./clientForm";

// i18next-shaped translate: fall back to the message's own default wording.
const t = (key: string, options?: Record<string, unknown>) => {
  const template = typeof options?.defaultValue === "string" ? options.defaultValue : key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (options && name in options ? String(options[name]) : match));
};

const US: Country = { code: "US", name: "United States", phone_code: "+1" };

const detail: ClientDetail = {
  client_id: "client-1",
  client_name: "Acme",
  client_type: "company",
  url: "acme.com",
  phone_no: "+13202521658",
  email: "ops@acme.test",
  is_inactive: false,
  properties: { industry: "MSP" },
};

const location: ClientLocation = {
  location_id: "loc-1",
  location_name: null,
  address_line1: "1 Main St",
  city: "Springfield",
  state_province: "IL",
  postal_code: "62701",
  country_code: "US",
  country_name: "United States",
  phone: "+13202521658",
  email: "ops@acme.test",
  is_default: true,
};

describe("client form", () => {
  it("starts empty with the tenant's country preselected", () => {
    expect(emptyClientForm("gb").countryCode).toBe("GB");
    expect(emptyClientForm(null).countryCode).toBe("");
    expect(hasLocationData(emptyClientForm("US"))).toBe(false);
  });

  it("loads the client and its default location into the form", () => {
    const values = clientFormFromDetail(detail, defaultClientLocation([{ ...location, is_default: false, location_id: "other" }, location]), null);
    expect(values).toMatchObject({
      clientName: "Acme",
      clientType: "company",
      website: "acme.com",
      industry: "MSP",
      phone: "+13202521658",
      email: "ops@acme.test",
      addressLine1: "1 Main St",
      city: "Springfield",
      countryCode: "US",
    });
  });

  it("applies the web's shared field rules and wording", () => {
    const values = { ...emptyClientForm(null), email: "not-an-email", phone: "abc", website: "not a url", postalCode: "ABC", addressLine1: "1 Main St" };
    const { errors } = validateClientForm(values, t, null);
    expect(errors.clientName).toBe("Client name is required");
    expect(errors.email).toBe("Please enter a valid email address");
    expect(errors.phone).toBe("Please enter a valid phone number");
    expect(errors.website).toBe("Please enter a valid website URL (e.g., apple.com)");
    expect(errors.postalCode).toBe("Please enter a valid ZIP code (e.g., 12345 or 12345-6789)");
    expect(errors.country).toBe("Choose a country for the address.");
    expect(hasBlockingErrors(validateClientForm({ ...emptyClientForm("US"), clientName: "Acme" }, t, US))).toBe(false);
  });

  it("resolves national numbers against the chosen country and surfaces advise-layer warnings without blocking", () => {
    const check = validateClientForm({ ...emptyClientForm("US"), clientName: "LLC", phone: "(320) 555-0123", email: "ops@mailinator.com" }, t, US);
    expect(hasBlockingErrors(check)).toBe(false);
    expect(check.warnings.clientName).toBe("This is only a business abbreviation, not a name.");
    expect(check.warnings.phone).toBe("This is in the 555-0100 range reserved for fiction.");
    expect(check.warnings.email).toBe("mailinator.com is a disposable mailbox provider.");
  });

  it("builds the create payload without location fields", () => {
    const values = { ...emptyClientForm("US"), clientName: " Acme ", clientType: "individual" as const, industry: "MSP", phone: "320 252 1658" };
    expect(buildClientCreatePayload(values)).toEqual({
      client_name: "Acme",
      client_type: "individual",
      url: "",
      is_inactive: false,
      properties: { industry: "MSP" },
    });
  });

  it("sends only the client fields that changed, with the deactivation answer when going inactive", () => {
    const values = clientFormFromDetail(detail, location, null, ["vip"]);
    expect(buildClientUpdatePayload(values, detail, { originalTags: ["VIP"] })).toEqual({});
    expect(
      buildClientUpdatePayload(
        { ...values, clientName: "Acme Corp", isInactive: true, industry: "", accountManagerId: "user-2", tags: ["vip", "msp"] },
        detail,
        { originalTags: ["vip"], deactivateContacts: false },
      ),
    ).toEqual({
      client_name: "Acme Corp",
      is_inactive: true,
      deactivate_contacts: false,
      account_manager_id: "user-2",
      properties: { industry: "" },
      tags: ["vip", "msp"],
    });
  });

  it("includes account manager, notes and tags on create", () => {
    const values = { ...emptyClientForm("US"), clientName: "Acme", accountManagerId: "user-1", accountManagerName: "Sam", notes: "Gate code 4321", tags: ["vip"] };
    expect(buildClientCreatePayload(values)).toEqual(expect.objectContaining({ account_manager_id: "user-1", notes: "Gate code 4321", tags: ["vip"] }));
  });

  it("re-checks a single field on blur without touching the others", () => {
    const values = { ...emptyClientForm("US"), email: "nope", phone: "abc" };
    const full = validateClientForm(values, t, US);
    const current = { errors: { phone: "stale" }, warnings: {} };
    expect(recheckField(current, full, "email")).toEqual({ errors: { phone: "stale", email: "Please enter a valid email address" }, warnings: { email: undefined } });
  });

  it("normalizes the phone into the location payload using the chosen country", () => {
    const values = { ...emptyClientForm("US"), clientName: "Acme", phone: "(320) 252-1658", email: "Ops@Acme.test " };
    expect(buildLocationPayload(values, US)).toEqual(expect.objectContaining({
      phone: "+13202521658",
      email: "ops@acme.test",
      country_code: "US",
      country_name: "United States",
      is_default: true,
      address_line1: "",
    }));
  });

  it("skips the location when nothing was entered unless an existing row must be cleared", () => {
    const empty = { ...emptyClientForm("US"), clientName: "Acme" };
    expect(buildLocationPayload(empty, US)).toBeNull();
    // Clearing an existing row sends null for the email so the server drops it; create never sends a blank email.
    expect(buildLocationPayload(empty, US, true)).toEqual(expect.objectContaining({ phone: "", address_line1: "", city: "", email: null }));
    expect(buildLocationPayload({ ...empty, phone: "320 252 1658" }, US)).not.toHaveProperty("email");
    expect(buildLocationPayload({ ...empty, phone: "320 252 1658" }, null)).toBeNull();
  });
});
