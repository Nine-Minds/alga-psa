# Billing for MSPs with Alga PSA

## Draft

This guide explains how billing works in Alga PSA from an MSP operator's point of view. It is intended to help billing admins, service managers, and owners understand how client billing schedules, contracts, contract lines, recurring fees, time, usage, and invoice generation fit together.

This is a practical guide, not a technical reference.

## The Core Mental Model

Alga PSA separates three ideas that MSPs often mix together:

1. **What you sell**
   - Services and products in your catalog.
2. **How a specific client is supposed to be billed**
   - The client's billing schedule.
3. **How particular work should be priced or included**
   - Contracts and contract lines.

That separation matters because the same service can be sold to different clients in different ways:

- as a fixed monthly fee
- as hourly labor
- as usage
- as a bucket or included amount with overages
- as a passthrough product or license

In Alga PSA, the service catalog tells the system what the service is. Contracts tell the system how that client's work should be billed.

## Key Objects

### Service Catalog

The service catalog is your master list of services and products.

It should answer questions like:

- What is this offering called?
- Is it a service or a product?
- What is the default price?
- Is it taxable?

It should **not** be the place where you decide client-specific billing behavior.

### Client Billing Schedule

The client billing schedule defines the client's normal invoice cadence.

Examples:

- Monthly on the 1st
- Monthly on the 15th
- Quarterly
- Weekly

Think of this as the client's default billing rhythm.

### Contract

A contract is the billing arrangement for one client.

It answers questions like:

- Which recurring fees does this client have?
- Which services are included?
- Which services bill hourly?
- Which services bill by usage?
- Are there special rates, included quantities, or buckets?

A client can have more than one active contract if needed.

### Contract Line

A contract line is the actual billable rule.

Examples:

- Fixed fee for managed services
- Hourly billing for project labor
- Usage billing for backups or devices
- Included hours with overage billing

Most billing behavior that matters operationally lives at the **contract line** level.

## Two Cadence Sources

Recurring contract lines can follow one of two cadence sources.

### 1. Client Schedule

Use **Client schedule** when the recurring line should bill on the client's normal invoice cycle.

Example:

- The client bills monthly on the 1st.
- A recurring fee using **Client schedule** will line up with that client billing window.

This is the best choice when you want multiple recurring items to naturally line up on the same invoice.

### 2. Contract Anniversary

Use **Contract anniversary** when the recurring line should bill based on the contract's own start date rather than the client's standard billing cycle.

Example:

- Contract starts on March 15.
- A monthly recurring line using **Contract anniversary** will produce windows like:
  - March 15 to April 15
  - April 15 to May 15

This is useful when a particular agreement must follow its own commercial cadence.

## Billing Timing: Advance vs Arrears

Recurring lines also have a billing timing.

### Advance

**Advance** means the line is billed at the start of the period it covers.

Example:

- Service period: March 1 to April 1
- Invoice window: March 1 to April 1

This is common for fixed recurring managed services fees.

### Arrears

**Arrears** means the line is billed after the service period has been delivered.

Example:

- Service period: March 1 to April 1
- Invoice window: April 1 to May 1

This is often appropriate when the MSP wants to bill after delivery instead of before.

## How Recurring Invoice Windows Work

The recurring invoicing system works from **invoice windows**.

That matters because two different contract lines can only be combined automatically if their invoice windows match.

### If invoice windows match perfectly

Alga can show them together and generate one combined invoice.

Example:

- Line A: Client schedule, advance, March 1 to April 1
- Line B: Contract anniversary, advance, March 1 to April 1

Because the invoice windows are identical, they can be combined.

### If invoice windows do not match

They must invoice separately.

Example:

- Line A: March 1 to April 1
- Line B: March 15 to April 15

These will appear as separate invoiceable rows.

## How Automatic Invoicing Thinks

On the Automatic Invoicing screen, Alga PSA looks for due billing work and groups it by:

- client
- invoice window
- compatibility for combined invoicing

If multiple recurring items for the same client fall into the same invoice window, the system can collapse them into a single parent row.

When that happens:

- the parent row represents one possible combined invoice
- the child rows represent the individual obligations inside that group

If the items are compatible, the parent can be selected and invoiced as one invoice.

If the items are not compatible, they still appear under the same general client context, but they must be selected individually.

## When Items Can Be Combined

In general, recurring items can be combined when:

- they belong to the same client
- their invoice windows match exactly
- their accounting and invoicing constraints are compatible

Examples of things that may prevent combining include:

- different invoice windows
- incompatible purchase order context
- incompatible export or accounting requirements
- other billing constraints that require separation

The system is designed to combine only when it is safe.

## Contracts and Time Entries

Contracts do more than drive recurring fees. They also shape how time and usage are billed.

For hourly and usage-based work, the contract tells Alga PSA things like:

- whether a service should bill hourly, by usage, or be included
- what rate to use
- whether the work should count toward an included bucket
- whether overages should be charged

This is why MSPs should think of contracts as the billing instructions for a client, not just as a recurring fee container.

## Best Practice: Cover Billable Work with Explicit Contracts

The cleanest setup is:

- every important recurring service has an explicit contract line
- every expected hourly service has an explicit contract line
- every expected usage-billed service has an explicit contract line

That gives you:

- predictable pricing
- cleaner invoice previews
- fewer surprises with unmatched work
- simpler reporting and review

If work is billable and expected to recur operationally, it is usually worth covering with a real contract configuration.

## Fixed Fee vs Hourly vs Usage

### Fixed Fee

Use a fixed-fee line when the client pays a recurring amount regardless of measured activity.

Examples:

- monthly managed services fee
- security operations retainer
- flat support package

### Hourly

Use an hourly line when labor should bill according to approved time entries.

Examples:

- project labor
- out-of-scope support
- consulting

### Usage

Use a usage line when a measurable quantity drives billing.

Examples:

- devices
- users
- backups
- monitored endpoints

## Buckets and Included Amounts

Some contract lines let you define included amounts with overages.

Examples:

- 10 included hours, then hourly overage
- 100 included units, then per-unit overage

This is useful for MSP agreements that blend predictable recurring revenue with controlled overage billing.

## Multiple Contracts for the Same Client

A client can have more than one active contract.

This is useful when:

- one agreement covers core managed services
- another covers a project
- another covers a specific add-on offering

The important thing to remember is:

- multiple contracts do **not** automatically mean multiple invoices
- if the due items line up on the same invoice window and are compatible, they can still combine onto one invoice

So operationally, you can split commercial arrangements across multiple contracts without necessarily fragmenting the client's invoice experience.

## Editing Cadence After Contract Creation

You can change cadence behavior on a contract line after a contract is created, as long as it is safe to do so.

For example:

- moving a recurring line from **Client schedule** to **Contract anniversary**
- moving it back the other way
- changing from **Arrears** to **Advance**

When you do that, the important business expectation is:

- the line should move onto the new live recurring schedule
- invoicing should follow the updated cadence
- the old schedule should no longer be the active invoiceable path

In practice, you should always verify the result in:

- **Service Periods**
- **Automatic Invoicing**

after a significant cadence edit.

## How to Think About Service Periods

The Service Periods screen is the operational inspection tool for recurring billing.

Use it to answer questions like:

- What recurring windows exist for this line?
- Is this line billing in advance or arrears?
- What is the service period?
- What is the invoice window?
- Has this recurring work already been billed?

If Automatic Invoicing looks confusing, Service Periods is usually the first place to inspect the underlying recurring schedule.

## Recommended MSP Patterns

### Pattern 1: Keep core MRR on Client Schedule

For most MSPs, the cleanest pattern is:

- fixed recurring managed services fees use **Client schedule**
- billed in **Advance**

Why:

- it keeps core recurring revenue aligned to the client's main invoice cycle
- it makes combined invoicing easier
- it is easier for finance and account management to review

### Pattern 2: Use Contract Anniversary Only When You Need a Separate Commercial Rhythm

Use **Contract anniversary** when a line truly should follow its own timeline.

Good examples:

- a service that starts mid-month and must continue on that anniversary
- a special agreement that should not snap to the client's normal cycle

### Pattern 3: Make Hourly and Usage Rules Explicit

If technicians regularly log time against a service, or usage is regularly measured, create explicit contract treatment for it.

This reduces ambiguity and makes invoice previews much easier to trust.

## Common Real-World Examples

### Example A: Standard Managed Services Client

- Client billing schedule: monthly on the 1st
- Managed services fee: client schedule, advance
- Backup fee: client schedule, advance
- Out-of-scope project labor: hourly

Result:

- recurring fees line up naturally
- recurring fees can combine on one monthly invoice
- project time can still be billed according to the contract rules

### Example B: Mid-Month Security Add-On

- Client billing schedule: monthly on the 1st
- Core MSP package: client schedule, advance
- Security add-on contract starts March 15
- Security add-on line: contract anniversary, advance

Result:

- the add-on may invoice on a different window
- it may appear separately from the core monthly invoice

### Example C: Retainer with Overage

- Fixed recurring fee covers a base service
- Contract line includes 10 hours
- Extra hours bill at the overage rate

Result:

- the recurring fee gives predictable revenue
- overages give clear, rules-based extra billing

## Why a Line Might Not Show in Automatic Invoicing

If a line is missing from Automatic Invoicing, check:

1. Is the contract line active and saved?
2. Does it have a billing frequency?
3. Does it have a cadence owner?
4. Does it have a billing timing?
5. Does the current invoice window actually make it due yet?
6. Does Service Periods show a live recurring row for it?
7. Has it already been billed for that window?

In most recurring billing troubleshooting, the fastest path is:

1. verify the contract line settings
2. verify Service Periods
3. verify Automatic Invoicing

## Practical Operating Advice

- Use **Client schedule** for most standard recurring MSP fees.
- Use **Contract anniversary** sparingly and intentionally.
- Use **Advance** when the client should pay at the beginning of the covered period.
- Use **Arrears** when the client should pay after delivery.
- Keep hourly and usage billing explicit in contracts.
- Review Service Periods after major cadence edits.
- Review invoice previews before generation when testing new billing setups.

## A Simple Rule of Thumb

If you want the billable item to ride along with the client's normal monthly invoice, use:

- **Client schedule**
- usually **Advance**

If you want the billable item to follow its own commercial anniversary, use:

- **Contract anniversary**
- either **Advance** or **Arrears**, depending on whether you bill before or after delivery

## Related Documents

- [Billing System Design](./billing.md)
- [Billing Cycles](./billing_cycles.md)
- [Credits and Reconciliation](./credits_and_reconciliation.md)
- [Invoice Templates](./invoice_templates.md)
