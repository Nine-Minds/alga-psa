# Task Document Folder Selector Design

## Goal

Make the project task dialog document flow match the ticket details document flow when creating or uploading a document.

## Problem

`packages/projects/src/components/TaskDocumentsSimple.tsx` currently special-cases pending task mode (`!taskId`):

- `New` skips folder selection and creates the document at the root.
- `Upload` passes `folderPath: null`, which bypasses the shared upload folder chooser and uploads to the root.

This differs from the ticket details screen, which uses the shared documents flow and prompts for a destination folder before creating or uploading.

## Decision

Update the task dialog so pending task mode follows the same folder-selection flow as tickets:

- `New` always opens `FolderSelectorModal` before opening the document editor.
- `Upload` no longer forces root-folder upload in pending mode, allowing the shared upload component to prompt for a destination folder.

Link-existing behavior remains unchanged.

## Scope

Only change the project task document UI behavior in `TaskDocumentsSimple.tsx`.

Do not change:

- ticket documents behavior
- document association behavior on task save
- linked-document selection behavior

## Expected Result

- In task create mode, clicking `New` shows the folder selector first.
- In task create mode, clicking `Upload` shows the folder selector before upload starts.
- In task edit mode, behavior remains unchanged.
- Ticket details remains the reference behavior and is unaffected.

## Verification

- Open the task dialog in create mode and confirm `New` shows the folder picker.
- Open the task dialog in create mode and confirm `Upload` shows the folder picker.
- Open the task dialog in edit mode and confirm create/upload still work.
- Confirm ticket details document behavior is unchanged.
