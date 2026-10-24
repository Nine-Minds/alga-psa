# Projects and tasks

Customer projects can be shared separately from ticket boards. MSP task assignment, task editing, history and effort operate on qualified customer records.

## Before you start

The October 17 fixture catalog reports **no customer projects**. Prepare a disposable customer project, phase and at least two tasks through the customer's normal [Projects](http://feature-co-managed-it.localhost:23374/msp/projects) screen. Record their links and original values. Do not reuse September project/task links.

Use a customer administrator to approve project access and an MSP administrator to assign an eligible technician/team. Use QA only after that authority is established. See [Access policies](03-access-policies.md) and [fixture identities](README.md#fixtures).

## Risks to check

- Access to an entire customer project through an unrelated ticket grant.
- MSP task assignment overwriting customer-local assignment.
- An edit changing the wrong task or silently overwriting newer work.
- Shared task effort disappearing or becoming customer commercial billing.

## 1. Share only the prepared project

As the customer, open **Co-managed access → Projects**, search for the disposable project, add it with **Collaborate**, and **Save access**. Reload. As the MSP, assign the intended staff/team within that customer-approved project scope.

Open [Project task queues](http://feature-co-managed-it.localhost:23374/msp/co-management/tasks). Compare the working and oversight views and assignment filters such as **Assigned to me** and **Assigned to my teams**. Follow an actual task link from the queue or approved project list.

Expected: the project grant controls which customer tasks are reachable. A different unshared project remains unavailable. Shared detail links retain the customer and relationship identity.

## 2. Persist a task edit with attribution

Open a prepared task. In its editor, change **Task name**, select an offered **Status**, or change **Due date**, then **Save access** (the shared save label). Use only fields offered as editable. Reload the task and inspect **Change history**; then open the customer's native task screen.

Expected: both organizations see the same permitted values after reload. History records the change with qualified author attribution. Restore reversible values with another ordinary save; history should remain.

## 3. Separate MSP assignment from local ownership

In **MSP assignment**, choose **Assign to → Technician** or **Team**, choose an eligible assignee and select **Assign**. Reload and compare the working queue. Use **Remove MSP assignment**, reload, and compare again.

Expected: MSP assignment changes the MSP's task routing without replacing customer-local assignment. Only eligible assigned principals are offered. An arbitrary MSP user does not gain project access through assignment alone.

## 4. Detect stale work and revoked access

Open the same task in both organizations. Save a customer change, then try to save an older conflicting MSP edit. Use **Discard changes and reload** when offered.

Expected: the older editor reports the task changed and reloads current values rather than overwriting them. For the disposable project, remove its customer grant and save. Refresh the old task URL and queue as the MSP: fresh access must close, including conversation and file reads.

## 5. Compare effort and conversations

While the grant is active, use **Log time** on the shared task and inspect effort after reload. Review task messages and audience separation using [Conversations and files](07-conversations-and-files.md). Check that project totals include the task's recorded effort without counting it twice.

## Pass criteria and recovery

Pass when scope, edits, assignment, history and effort refer to the same customer-owned task, and revocation closes fresh reads. Record new project/task links for future review. Restore scope and assignments only if this fixture will be reused; preserve task history and recorded time.

## Source references

- [Project tasks and qualified links](../../../server/src/components/co-managed/CoManagedProjectTasks.tsx)
- [Task editor](../../../server/src/components/co-managed/CoManagedProjectTaskEditor.tsx)
- [MSP task assignment](../../../server/src/components/co-managed/CoManagedProjectTaskAssignment.tsx)
- [Task edit enforcement](../../../packages/co-managed/src/projectTaskEditing.ts)

