# Control who sees a service request and which fields appear

A service request definition has two separate visibility controls. They sit close together in the editor and are easy to mix up.

| Section in the editor | What it controls | Where it applies |
| --- | --- | --- |
| **Who can see this form** | Which client users can open the request at all. | The client portal's list of requests and the request's own page. |
| **Show or hide fields (advanced)** | Which fields appear inside the form, and which values are prefilled. | The form itself, while the client fills it in. |

> **Former names.** Earlier versions called these sections **Visibility Configuration** (now **Who can see this form**) and **Advanced Form Behavior** (now **Show or hide fields (advanced)**). The JSON editor inside the second section was labelled **Advanced (JSON)** and is now **Edit as JSON**.

"Who can see this form" is configured with the audience picker (clients, client tags, contact tags and client groups). It does not hide or show answers inside the form. Everything below is about the second section.

## The recommended way: "Show when…"

Open a field in the form editor and use **Show when…** to add one or more conditions. The editor only offers fields that appear earlier in the form, and it writes the rules for you. Most admins never need to touch JSON.

Use **Edit as JSON** when you want to change many rules at once, or when you need `contextDefaults`, which have no other editor.

## Where the JSON lives

In the **Show or hide fields (advanced)** section, expand **Edit as JSON**. The text box holds the whole configuration for the form. It is a JSON object that can contain two keys, `visibilityRules` and `contextDefaults`. Save with **Save Form Behavior Config**; the configuration is checked in full when you publish.

## `visibilityRules`

`visibilityRules` is a list. Each entry attaches one condition to one field:

```json
{ "fieldKey": "tell_us_more", "source": "reason", "operator": "equals", "value": "Other" }
```

| Property | Meaning |
| --- | --- |
| `fieldKey` | The key of the field this condition controls. |
| `source` | Where the compared value comes from: another field's key, or one of `context.requesterUserId`, `context.clientId`, `context.contactId`. |
| `operator` | How to compare. See the table below. |
| `value` | The value to compare against. Required for `equals` and `not-equals`, ignored by the other operators. |

How conditions combine:

- A field with **no** condition is always shown.
- A field with several conditions is shown only when **all** of them pass. There is no OR; conditions are combined with AND only.
- A field used as `source` should appear **earlier** in the form than the field it controls. Fields are evaluated from top to bottom, so a later field has not been decided yet. "Show when…" only offers earlier fields for this reason.
- A hidden field counts as empty. If you hide a controlling field, every field that depends on it is evaluated against an empty value too, so those fields are hidden or shown according to that empty value. Choose conditions with that in mind.
- Answers to hidden fields, including prefilled values, are not submitted with the request. A prefilled value only reaches the ticket or workflow if its field is visible.
- For `select` fields, compare against the option's stored value, not its display label.

### Operators

| Operator | Passes when the source value… |
| --- | --- |
| `equals` | equals `value` exactly. |
| `not-equals` | does not equal `value`. |
| `is-true` | is checked / true. |
| `is-false` | is unchecked / false, or empty. |
| `has-value` | is not empty. |
| `is-empty` | is empty. |

## `contextDefaults`

`contextDefaults` gives a field its starting value. The keys are field keys. A string value may contain these placeholders, which are replaced with details of the client user who opens the form:

| Placeholder | Replaced with |
| --- | --- |
| `{{clientId}}` | The requesting user's client. |
| `{{contactId}}` | The requesting user's contact, or an empty value if the user has none. |
| `{{requesterUserId}}` | The requesting user. |

Each placeholder is replaced once per value, so write it once.

## Examples

Field keys here are illustrative; use the keys from your own form.

**Show "Tell us more" only when "Reason" equals "Other"**

```json
{
  "visibilityRules": [
    {
      "fieldKey": "tell_us_more",
      "source": "reason",
      "operator": "equals",
      "value": "Other"
    }
  ]
}
```

**Hide "Company" when "I am the end user" is checked**

```json
{
  "visibilityRules": [
    {
      "fieldKey": "company",
      "source": "i_am_end_user",
      "operator": "is-false"
    }
  ]
}
```

`is-false` passes when the box is unchecked, so "Company" is shown only in that case.

**Show "Site code" only for one client, and prefill "Client reference" with the client's ID**

```json
{
  "visibilityRules": [
    {
      "fieldKey": "site_code",
      "source": "context.clientId",
      "operator": "equals",
      "value": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "contextDefaults": {
    "client_reference": "{{clientId}}"
  }
}
```

This example uses both keys. Replace the placeholder `value` with the ID of your client: open the client in the MSP portal and copy the ID from the address (`/msp/clients/<client ID>`). Users of that client see "Site code"; everyone else does not.

"Client reference" has no rule, so it is always visible and its prefilled value is submitted. The prefilled value is the client's ID, and the client user can see and edit it in the form. Because answers to hidden fields are not submitted, do not prefill a field that a rule hides.

## When rules are applied

- **Prefilled values** are filled in when the client opens the form.
- **Conditions** are checked in the client's browser while they fill in the form, so fields appear and disappear as the answers change. They are checked again on the server when the client submits, using the submitted answers. A field that is hidden is never required.
- Changes you save apply to the next version you publish.

## Availability

**Edit as JSON** and its help appear only when the definition uses the Enterprise **advanced** form-behavior provider. Without it, the section is not shown and per-field **Show when…** is not available either. The audience picker under **Who can see this form** is available in every edition.
