"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@alga-psa/ui/components/Button";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import { Dialog, DialogContent } from "@alga-psa/ui/components/Dialog";
import { Input } from "@alga-psa/ui/components/Input";
import { Label } from "@alga-psa/ui/components/Label";
import { TextArea } from "@alga-psa/ui/components/TextArea";
import {
  formatCalendarDate,
  getCurrentDateInUserTimeZone,
} from "@alga-psa/core";
import type { AssetMaintenanceOccurrence } from "@alga-psa/types";
import { advanceMaintenanceDate } from "../lib/maintenanceRecurrence";

export type MaintenanceCompletionValues = {
  performedDate: string;
  notes: string;
  maintenanceData: Record<string, unknown>;
};

type ChecklistItem = { key: string; label: string };

function checklistItems(
  config: Record<string, unknown> | undefined,
): ChecklistItem[] {
  const checklist = config?.checklist;
  if (!Array.isArray(checklist)) return [];
  return checklist.flatMap((item, index) => {
    if (typeof item === "string" && item.trim())
      return [{ key: `checklist_${index + 1}`, label: item }];
    if (item && typeof item === "object") {
      const value = item as { id?: unknown; label?: unknown; name?: unknown };
      const label =
        typeof value.label === "string"
          ? value.label
          : typeof value.name === "string"
            ? value.name
            : undefined;
      if (label?.trim())
        return [
          {
            key:
              typeof value.id === "string"
                ? value.id
                : `checklist_${index + 1}`,
            label,
          },
        ];
    }
    return [];
  });
}

export function MaintenanceCompletionDialog({
  occurrence,
  isOpen,
  onClose,
  onComplete,
  idPrefix,
}: {
  occurrence: AssetMaintenanceOccurrence | null;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (values: MaintenanceCompletionValues) => Promise<void>;
  idPrefix: string;
}) {
  const items = useMemo(
    () => checklistItems(occurrence?.schedule_config),
    [occurrence?.schedule_config],
  );
  const [performedDate, setPerformedDate] = useState(
    getCurrentDateInUserTimeZone,
  );
  const [notes, setNotes] = useState("");
  const [completedChecklist, setCompletedChecklist] = useState<
    Record<string, boolean>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPerformedDate(getCurrentDateInUserTimeZone());
    setNotes("");
    setCompletedChecklist(
      Object.fromEntries(items.map((item) => [item.key, false])),
    );
    setError(null);
  }, [isOpen, occurrence?.occurrence_id, items]);

  const nextDue = useMemo(() => {
    if (!occurrence || !performedDate) return null;
    try {
      return formatCalendarDate(
        advanceMaintenanceDate(
          performedDate,
          occurrence.frequency || "monthly",
          occurrence.frequency_interval || 1,
        ),
        "MMM d, yyyy",
      );
    } catch {
      return null;
    }
  }, [occurrence, performedDate]);

  const submit = async () => {
    if (!performedDate) {
      setError("A performed date is required.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onComplete({
        performedDate,
        notes,
        maintenanceData: Object.fromEntries(
          items.map((item) => [
            item.key,
            Boolean(completedChecklist[item.key]),
          ]),
        ),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to complete maintenance.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Complete maintenance"
      id={`${idPrefix}-complete-maintenance-dialog`}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            id={`${idPrefix}-cancel-maintenance-completion`}
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            id={`${idPrefix}-confirm-maintenance-completion`}
            onClick={submit}
            disabled={isSubmitting}
          >
            Complete
          </Button>
        </div>
      }
    >
      <DialogContent>
        <div className="space-y-4">
          <div>
            <Label htmlFor={`${idPrefix}-maintenance-performed-date`}>
              Performed date
            </Label>
            <Input
              id={`${idPrefix}-maintenance-performed-date`}
              type="date"
              value={performedDate}
              onChange={(event) => setPerformedDate(event.target.value)}
            />
          </div>
          <p className="rounded-md bg-[rgb(var(--color-primary-50))] p-3 text-sm text-[rgb(var(--color-text-700))]">
            Next due advances from this completion date to{" "}
            <strong>{nextDue ?? "an unavailable date"}</strong>.
          </p>
          {items.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                Checklist
              </div>
              {items.map((item) => (
                <Checkbox
                  key={item.key}
                  id={`${idPrefix}-maintenance-checklist-${item.key}`}
                  label={item.label}
                  checked={Boolean(completedChecklist[item.key])}
                  onChange={(event) =>
                    setCompletedChecklist((current) => ({
                      ...current,
                      [item.key]: event.target.checked,
                    }))
                  }
                />
              ))}
            </div>
          )}
          <div>
            <Label htmlFor={`${idPrefix}-maintenance-completion-notes`}>
              Notes
            </Label>
            <TextArea
              id={`${idPrefix}-maintenance-completion-notes`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
            />
          </div>
          {error && (
            <p
              role="alert"
              className="text-sm text-[rgb(var(--badge-danger-text))]"
            >
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
