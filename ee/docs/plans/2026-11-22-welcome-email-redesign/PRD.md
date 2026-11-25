# Welcome email redesign

## What this is

The email a new customer receives when their AlgaPSA account is created ("Welcome to AlgaPSA - Your Account is Ready") is being redesigned and rewritten. Robert reviewed the email as sent by production on 2026-11-22 and approved a new design and new copy. This plan records both.

The approved design is `mockup.html` in this folder (open it in a browser). The card also carries a picture of it. The mockup uses sample names (Jordan, Acme IT); the picture on the card shows the test account Robert reviewed.

## Where the email lives

`ee/temporal-workflows/src/activities/email-activities.ts`

- `PSA_WELCOME_COPY` and `ALGADESK_WELCOME_COPY`: the per-product copy.
- `createWelcomeEmailContent`: builds the subject, the HTML body and the plain-text body.
- The file already carries a `LEVERAGE: pattern welcome-email-two-body-drift` marker: the HTML and plain-text bodies branch separately on portal status and have to be mirrored by hand.

## What Robert objected to

1. **The product name is written with a space.** It is "AlgaPSA", one word, as the app writes it. The spaced form appears in the plain-text heading `ALGA PSA WORKSPACE` and in the sender display name "Alga PSA".
2. **The word "tenant".** The footer says "sent automatically as part of your tenant creation process". Customers should not see "tenant" anywhere in this email.
3. **Marketing copy.** The italic paragraph "Say goodbye to scattered tools, manual workarounds, and overly complex systems…" sells a product the reader has already bought. The email should make them want to start using it, not sell it again.
4. **The look.** It reads as machine-generated and does not match the application:
   - a purple gradient banner with a large centred headline and the subtitle "Your account has been successfully created";
   - a run of tinted callout boxes with a thick coloured left border;
   - colours the app does not use here: a cyan support card and cyan button (`#40cff9`, `#f0fbff`, `#bae6fd`, `#0284c7`), an amber warning box, a dark slate footer;
   - emoji used as heading icons (🏢 👥 🔐 ⚠️).

## The approved design

One white panel on the app's page ground, in this order:

1. **Top bar** in the app's sidebar colour, with the logo, the product name, and the customer's company name on the right.
2. **Greeting and one opening sentence.** No headline.
3. **Sign-in details panel**: a small header row, then three label/value rows (sign in at, email, temporary password), then a footer row holding the one primary button and a short note beside it.
4. **One sentence introducing setup**, followed by a five-step stepper.
5. **One sentence about support**, with the portal as an inline link.
6. **Signature.**
7. **Footer**: one quiet line.

There is one primary button in the whole email. The support portal is a link, not a second button.

### Colours and type

Only the app's purple and its slate neutrals. No cyan, no amber, no gradient.

| Use | Value |
|---|---|
| Page ground | `#f7f8fa` |
| Panel | `#ffffff`, border `#e2e8f0`, radius 8px |
| Top bar | `#151024`, text `#e8e4f6`, company name `#9a92b8` |
| Body text | `#1e293b` |
| Labels and notes | `#64748b` |
| Panel header and row dividers | `#f8fafc`, `#e2e8f0`, `#f1f5f9` |
| Primary button and links | `#8a4dea`, white text, radius 6px |
| Stepper rings and numbers | `#c4b5fd`, `#7c3aed`; first step filled `#8a4dea` |
| Footer text | `#94a3b8` |

Type: Inter for everything, Poppins 600 for the product name in the top bar, a monospace face for the temporary password. Body copy is 16px; panel rows 14px; footer 12px.

The logo is the app's own (`server/public/avatar-purple-no-shadow.svg`). Email clients do not reliably show SVG, so the email needs a hosted PNG of it.

## The approved copy (AlgaPSA, support portal account created)

**Subject:** Your AlgaPSA account is ready

> Hi {first name},
>
> {Company} is set up on AlgaPSA and ready when you are. Here's what you need to get in.
>
> **Sign-in details**
> Sign in at: {login URL}
> Email: {email}
> Temporary password: {temporary password}
> [Sign in to AlgaPSA]  You'll pick your own password first.
>
> Once you're in, an onboarding wizard will get you up and running.
>
> 1 Your team · 2 First client · 3 Their contact · 4 Billing · 5 Ticketing
>
> If you get stuck, open a request in the Nine Minds support portal. The same email and temporary password work there.
>
> Glad to have you,
> The Nine Minds team
>
> Sent because an AlgaPSA account was created for {Company} with this address. If that wasn't you, reply and let us know.

The sentence "Once you're in, an onboarding wizard will get you up and running." is Robert's wording. Keep it exactly.

### Copy rules

- "AlgaPSA" is one word, everywhere, including the plain-text body and the sender name.
- Never "tenant".
- No emoji.
- No sales language. Nothing that argues for the product.
- The separate "Important Security Information" box goes away. Its content is the one note beside the button.
- The "What's Next?" numbered list and the "Need Help?" section go away. The stepper and the support sentence replace them.

## What has to keep working

The mockup shows one case. The real template covers more, and all of it must survive:

- **AlgaDesk.** `ALGADESK_WELCOME_COPY` gets the same design and the same tone. Its setup steps must be the ones AlgaDesk's own setup actually shows.
- **Portal status.** The current code only claims support portal access it can stand behind:
  - `created`: the temporary password was set on a new portal account. The approved support sentence applies.
  - `existing`: a portal account already exists with the customer's own password. The email must not say the temporary password works there.
  - `failed`: say portal access is still being set up and that a reply to this email reaches us.
  - `skipped` or absent: no portal claim at all; offer the reply channel.
- **The plain-text body.** It carries the same copy, in the same order, with no emoji and no upper-case headings that respell the product name.
- **Outlook.** The current button uses the VML pattern so it renders in Outlook. The new button must render there too. The stepper is drawn with CSS in the mockup; in the email it has to be built from tables so it holds up in Outlook and Gmail, and it must degrade to a readable numbered line.
- **Existing tests** that exercise the portal-access branches of `createWelcomeEmailContent`.

Because the two bodies are now being rewritten together, this is the moment to act on the existing LEVERAGE marker: one structured copy model that both the HTML and the plain-text renderers read, so the portal branches are decided once.

## To check before the copy ships

These were not verified when the copy was written:

1. **Does the temporary password still open the support portal after the customer has changed their workspace password?** The approved support sentence says the same credentials work there. If the portal password does not follow the workspace one, the sentence needs to say what does happen.
2. **Does a reply to this email reach anyone?** The email is sent from a no-reply address, while the footer and the fallback support copy ask the reader to reply. A comment in the current code says replies reach Nine Minds; confirm it for the address production actually sends from.
3. **The setup steps.** The stepper names come from the step titles in `packages/onboarding/src/components/OnboardingWizard.tsx` (Team Members, Add Client, Client Contact, Billing, Ticketing). Confirm the list and order against what a new account really sees, including any step that comes before these.
4. **The sender display name.** It arrives as "Alga PSA". Find where it is set and make it "AlgaPSA".
5. **The sign-in address.** The email shows the general login URL, not one specific to the customer. Confirm that is where a new customer should land.

## Not part of this

- Other emails. Only the welcome email changes.
- The onboarding wizard itself.
- How accounts or portal users are provisioned.

## Done when

- A new AlgaPSA account receives an email that matches `mockup.html` in Gmail, Apple Mail and Outlook, in the order and colours above.
- The copy matches the approved text, with Robert's setup sentence unchanged.
- "Alga PSA" with a space, "tenant", emoji, cyan and amber appear nowhere in the HTML body, the plain-text body, the subject or the sender name.
- Each portal status produces copy that claims only what is true for it, in both bodies.
- AlgaDesk accounts receive the same design with their own product name and setup steps.
- The five open checks above each have an answer recorded on the card.
