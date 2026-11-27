# Restrict co-managed seat picker options and actions

## Problem and outcome

A client technician works in the sponsoring MSP tenant. Several pickers load tenant-wide options or use a person’s visibility as permission to assign work to them. Two paths have additional consequences: the category picker can change board configuration, and adding watchers can return private MSP email addresses. A seat technician should receive only the choices, actions and fields allowed for the operation they are performing.

## Implementation and acceptance

1. **Category creation.** Make the Add Ticket category creation affordance and its server action require the appropriate ticket-settings authority for the target board. A stock seat technician cannot change board configuration. An authorized settings administrator can still create a category.
2. **Document associations.** Apply target record read authorization to client, contact and ticket options in both filtering and upload association selection. Use the arrangement client and readable board scope. Return only fields needed to render permitted options. Apply scope before search, paging, counts and hydration. Preserve the client portal’s visibility rules.
3. **Timesheet work items.** Apply each resource’s read policy before combining and counting branches in Add Work Item. For seats, offer authorized tickets and tasks in explicitly shared projects. Exclude interactions and ad hoc schedule entries. Project joined labels and metadata according to the viewer’s access, including linked ticket parents and commercial service references.
4. **Boards and dependent options.** Derive choices from the operation. Add Ticket needs boards that permit creation. Ticket-list filters need readable boards. Existing-ticket destination choices must agree with the placement policy for updates. Check status and category option loaders independently, including preselected boards. Keep administrative board listing available to authorized users.
5. **Ticket assignments.** Feed classic and Bento primary and additional assignee controls the set of people the caller may assign. Keep mentions and other read-only displays on the existing people projection. Retain server-side assignment enforcement.
6. **Watchers.** Validate explicit watcher selections against the permitted people for that ticket. Project the create response for the caller, including board-default recipients. Keep the full email addresses needed by authorized notification delivery in server-side data.

## Delivery and verification

Start with the standard seat role in a sponsor tenant and real arrangement records. Use migrated database tests through the normal actions, with positive controls for an authorized MSP user. Check both options displayed in the UI and fields returned to the browser. Verify that bundle rules can narrow built-in seat scope and that a seat works with no configured bundle. Record the checks and outcomes for each finding on the card.

The existing client-picker card owns the general client/contact lookup fix used in Assets and ticket filters. Coordinate shared changes there. This card covers the six paths above. It requires no new administrator setup or seat grants. Verify current behavior against the card branch before deciding on implementation details.
