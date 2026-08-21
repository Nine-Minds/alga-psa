"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alga-psa/ui/components/Card";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { Button } from "@alga-psa/ui/components/Button";
import { Input } from "@alga-psa/ui/components/Input";
import { DateTimePicker } from "@alga-psa/ui/components/DateTimePicker";
import { TimePicker } from "@alga-psa/ui/components/TimePicker";
import {
  dateTimeFromString,
  dateTimeToString,
} from "@alga-psa/ui/lib/dateInput";
import { Label } from "@alga-psa/ui/components/Label";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { ClientPicker } from "@alga-psa/ui/components/ClientPicker";
import { Switch } from "@alga-psa/ui/components/Switch";
import { Badge } from "@alga-psa/ui/components/Badge";
import { Dialog } from "@alga-psa/ui/components/Dialog";
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useToast } from "@alga-psa/ui/hooks/use-toast";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import {
  isActionMessageError,
  isActionPermissionError,
} from "@alga-psa/ui/lib/errorHandling";
import {
  listRmmAlertRules,
  createRmmAlertRule,
  updateRmmAlertRule,
  deleteRmmAlertRule,
  reorderRmmAlertRules,
  listRmmMaintenanceWindows,
  createRmmMaintenanceWindow,
  updateRmmMaintenanceWindow,
  deleteRmmMaintenanceWindow,
  getRmmAlertRuleFormOptions,
  getRmmAlertPollingSettings,
  updateRmmAlertPollingSettings,
  type RmmAlertRuleFormOptions,
} from "../../../actions/integrations/rmmAlertRuleActions";
import type { IClient } from "@alga-psa/types";
import { getIntegrationClients } from "../../../actions/clientLookupActions";
import {
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Local type aliases matching the DB rows returned by actions
// ---------------------------------------------------------------------------

interface RmmAlertRuleRow {
  rule_id: string;
  integration_id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  priority_order: number;
  conditions: RuleConditions;
  actions: RuleActions;
}

interface RmmMaintenanceWindowRow {
  window_id: string;
  name: string;
  is_active: boolean;
  integration_id?: string | null;
  client_id?: string | null;
  asset_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  recurrence?: WeeklyRecurrence | null;
}

// ---------------------------------------------------------------------------
// Data shape types
// ---------------------------------------------------------------------------

type Severity = "critical" | "major" | "moderate" | "minor" | "none";

interface RuleConditions {
  severities?: Severity[];
  activityTypes?: string[];
  alertClasses?: string[];
  sourceTypes?: string[];
  organizationIds?: string[];
  messagePattern?: string;
  keywords?: string[];
}

interface RuleActions {
  createTicket: boolean;
  boardId?: string;
  priorityOverride?: string;
  assignToUserId?: string;
  ticketTemplate?: { titleTemplate?: string; descriptionTemplate?: string };
  autoResolveTicket: boolean;
  autoResolveStatusId?: string;
  resetAlertOnTicketClose: boolean;
  notifyUserIds?: string[];
}

interface WeeklyRecurrence {
  type: "weekly";
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RmmAlertAutomationSettingsProps {
  integrationId: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// Empty defaults
// ---------------------------------------------------------------------------

function emptyConditions(): RuleConditions {
  return {};
}

function emptyActions(): RuleActions {
  return {
    createTicket: true,
    autoResolveTicket: false,
    resetAlertOnTicketClose: true,
  };
}

const SEVERITIES: Severity[] = [
  "critical",
  "major",
  "moderate",
  "minor",
  "none",
];

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type Translator = (key: string, options?: Record<string, unknown>) => string;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinCsv(arr?: string[]): string {
  return (arr ?? []).join(", ");
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// Takes `unknown` on purpose: ee/server compiles with `strict: false`, where a
// boolean `if (res.success)` does not narrow the ActionResult union, so the
// type-predicate guards have to do the discriminating.
function actionResultError(result: unknown): string | undefined {
  if (isActionMessageError(result)) return result.actionError;
  if (isActionPermissionError(result)) return result.permissionError;
  return undefined;
}

function formatWindowSchedule(
  w: RmmMaintenanceWindowRow,
  t: Translator,
): string {
  if (w.recurrence?.type === "weekly") {
    const days = w.recurrence.days
      .map((d) =>
        DAY_KEYS[d]
          ? t(`integrations.rmm.alertAutomation.days.${DAY_KEYS[d]}`)
          : d,
      )
      .join(", ");
    return t("integrations.rmm.alertAutomation.schedule.weekly", {
      days,
      startTime: w.recurrence.startTime,
      endTime: w.recurrence.endTime,
    });
  }
  if (w.starts_at && w.ends_at) {
    return `${new Date(w.starts_at).toLocaleString()} – ${new Date(w.ends_at).toLocaleString()}`;
  }
  return t("integrations.rmm.alertAutomation.schedule.none");
}

function formatWindowScope(
  w: RmmMaintenanceWindowRow,
  integrationId: string,
  t: Translator,
): string {
  if (w.integration_id === integrationId)
    return t("integrations.rmm.alertAutomation.scope.thisIntegration");
  if (!w.integration_id)
    return t("integrations.rmm.alertAutomation.scope.allRmm");
  return t("integrations.rmm.alertAutomation.scope.otherIntegration");
}

function ruleSummaryChips(rule: RmmAlertRuleRow, t: Translator): string[] {
  const chips: string[] = [];
  const c = rule.conditions ?? {};
  if (c.severities?.length) {
    chips.push(
      c.severities
        .map((severity) =>
          t(`integrations.rmm.alertAutomation.severities.${severity}`),
        )
        .join(", "),
    );
  }
  const a = rule.actions ?? ({} as RuleActions);
  if (a.createTicket)
    chips.push(t("integrations.rmm.alertAutomation.summary.createsTicket"));
  if (a.autoResolveTicket)
    chips.push(t("integrations.rmm.alertAutomation.summary.autoResolve"));
  return chips;
}

// ---------------------------------------------------------------------------
// Rule editor form state
// ---------------------------------------------------------------------------

interface RuleFormState {
  name: string;
  description: string;
  isActive: boolean;
  // conditions
  severities: Severity[];
  activityTypes: string; // csv
  alertClasses: string; // csv
  sourceTypes: string; // csv
  keywords: string; // csv
  organizationIds: string[];
  messagePattern: string;
  // actions
  createTicket: boolean;
  boardId: string;
  priorityOverride: string;
  assignToUserId: string;
  titleTemplate: string;
  descriptionTemplate: string;
  autoResolveTicket: boolean;
  autoResolveStatusId: string;
  resetAlertOnTicketClose: boolean;
  notifyUserIds: string[];
}

function ruleToForm(rule: RmmAlertRuleRow): RuleFormState {
  const c = rule.conditions ?? {};
  const a = rule.actions ?? ({} as RuleActions);
  return {
    name: rule.name,
    description: rule.description ?? "",
    isActive: rule.is_active,
    severities: c.severities ?? [],
    activityTypes: joinCsv(c.activityTypes),
    alertClasses: joinCsv(c.alertClasses),
    sourceTypes: joinCsv(c.sourceTypes),
    keywords: joinCsv(c.keywords),
    organizationIds: c.organizationIds ?? [],
    messagePattern: c.messagePattern ?? "",
    createTicket: a.createTicket !== false,
    boardId: a.boardId ?? "",
    priorityOverride: a.priorityOverride ?? "",
    assignToUserId: a.assignToUserId ?? "",
    titleTemplate: a.ticketTemplate?.titleTemplate ?? "",
    descriptionTemplate: a.ticketTemplate?.descriptionTemplate ?? "",
    autoResolveTicket: Boolean(a.autoResolveTicket),
    autoResolveStatusId: a.autoResolveStatusId ?? "",
    resetAlertOnTicketClose: a.resetAlertOnTicketClose !== false,
    notifyUserIds: a.notifyUserIds ?? [],
  };
}

function formToRuleInput(form: RuleFormState): {
  conditions: RuleConditions;
  actions: RuleActions;
} {
  const conditions: RuleConditions = {};
  if (form.severities.length) conditions.severities = form.severities;
  const at = splitCsv(form.activityTypes);
  if (at.length) conditions.activityTypes = at;
  const ac = splitCsv(form.alertClasses);
  if (ac.length) conditions.alertClasses = ac;
  const st = splitCsv(form.sourceTypes);
  if (st.length) conditions.sourceTypes = st;
  const kw = splitCsv(form.keywords);
  if (kw.length) conditions.keywords = kw;
  if (form.organizationIds.length)
    conditions.organizationIds = form.organizationIds;
  if (form.messagePattern.trim())
    conditions.messagePattern = form.messagePattern.trim();

  const actions: RuleActions = {
    createTicket: form.createTicket,
    autoResolveTicket: form.autoResolveTicket,
    resetAlertOnTicketClose: form.resetAlertOnTicketClose,
  };
  if (form.boardId) actions.boardId = form.boardId;
  if (form.priorityOverride) actions.priorityOverride = form.priorityOverride;
  if (form.assignToUserId) actions.assignToUserId = form.assignToUserId;
  if (form.titleTemplate || form.descriptionTemplate) {
    actions.ticketTemplate = {};
    if (form.titleTemplate)
      actions.ticketTemplate.titleTemplate = form.titleTemplate;
    if (form.descriptionTemplate)
      actions.ticketTemplate.descriptionTemplate = form.descriptionTemplate;
  }
  if (form.autoResolveTicket && form.autoResolveStatusId) {
    actions.autoResolveStatusId = form.autoResolveStatusId;
  }
  if (form.notifyUserIds.length) actions.notifyUserIds = form.notifyUserIds;

  return { conditions, actions };
}

function defaultRuleForm(): RuleFormState {
  return {
    name: "",
    description: "",
    isActive: true,
    severities: [],
    activityTypes: "",
    alertClasses: "",
    sourceTypes: "",
    keywords: "",
    organizationIds: [],
    messagePattern: "",
    createTicket: true,
    boardId: "",
    priorityOverride: "",
    assignToUserId: "",
    titleTemplate: "",
    descriptionTemplate: "",
    autoResolveTicket: false,
    autoResolveStatusId: "",
    resetAlertOnTicketClose: true,
    notifyUserIds: [],
  };
}

// ---------------------------------------------------------------------------
// Window editor form state
// ---------------------------------------------------------------------------

type ScheduleType = "onetime" | "weekly";

interface WindowFormState {
  name: string;
  isActive: boolean;
  scopeThisIntegration: boolean;
  clientId: string | null;
  scheduleType: ScheduleType;
  // one-off
  startsAt: string; // datetime-local string
  endsAt: string;
  // weekly
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
}

function windowToForm(
  w: RmmMaintenanceWindowRow,
  integrationId: string,
): WindowFormState {
  const isWeekly = w.recurrence?.type === "weekly";
  return {
    name: w.name,
    isActive: w.is_active,
    scopeThisIntegration: w.integration_id === integrationId,
    clientId: w.client_id ?? null,
    scheduleType: isWeekly ? "weekly" : "onetime",
    startsAt: w.starts_at ? toDatetimeLocal(w.starts_at) : "",
    endsAt: w.ends_at ? toDatetimeLocal(w.ends_at) : "",
    days: w.recurrence?.days ?? [],
    startTime: w.recurrence?.startTime ?? "00:00",
    endTime: w.recurrence?.endTime ?? "23:59",
    timezone:
      w.recurrence?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function toDatetimeLocal(iso: string): string {
  // Convert ISO string to datetime-local value (YYYY-MM-DDTHH:mm)
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function defaultWindowForm(integrationId: string): WindowFormState {
  return {
    name: "",
    isActive: true,
    scopeThisIntegration: true,
    clientId: null,
    scheduleType: "onetime",
    startsAt: "",
    endsAt: "",
    days: [],
    startTime: "00:00",
    endTime: "06:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

interface WindowInput {
  name: string;
  integrationId: string | null;
  clientId: string | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  recurrence: WeeklyRecurrence | null;
}

function formToWindowInput(
  form: WindowFormState,
  integrationId: string,
): WindowInput {
  const base = {
    name: form.name,
    integrationId: form.scopeThisIntegration ? integrationId : null,
    clientId: form.clientId ?? null,
    isActive: form.isActive,
  };
  if (form.scheduleType === "onetime") {
    return {
      ...base,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      recurrence: null,
    };
  }
  return {
    ...base,
    startsAt: null,
    endsAt: null,
    recurrence: {
      type: "weekly" as const,
      days: form.days,
      startTime: form.startTime,
      endTime: form.endTime,
      timezone: form.timezone,
    },
  };
}

// ---------------------------------------------------------------------------
// Rule editor dialog
// ---------------------------------------------------------------------------

interface RuleEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  formState: RuleFormState;
  setFormState: React.Dispatch<React.SetStateAction<RuleFormState>>;
  onSave: () => Promise<void>;
  saving: boolean;
  formOptions: RmmAlertRuleFormOptions | null;
}

function RuleEditorDialog({
  isOpen,
  onClose,
  title,
  formState: f,
  setFormState: setF,
  onSave,
  saving,
  formOptions,
}: RuleEditorDialogProps) {
  const { t } = useTranslation("msp/integrations");
  const [patternError, setPatternError] = React.useState("");

  // The dialog stays mounted across open/close; clear session-local
  // validation state so a cancelled edit can't block the next rule.
  React.useEffect(() => {
    if (isOpen) setPatternError("");
  }, [isOpen]);

  const validatePattern = (val: string) => {
    if (val && !isValidRegex(val)) {
      setPatternError(
        t("integrations.rmm.alertAutomation.validation.invalidRegex"),
      );
    } else {
      setPatternError("");
    }
  };

  const toggleSeverity = (s: Severity) => {
    setF((prev) => ({
      ...prev,
      severities: prev.severities.includes(s)
        ? prev.severities.filter((x) => x !== s)
        : [...prev.severities, s],
    }));
  };

  const toggleOrgId = (id: string) => {
    setF((prev) => ({
      ...prev,
      organizationIds: prev.organizationIds.includes(id)
        ? prev.organizationIds.filter((x) => x !== id)
        : [...prev.organizationIds, id],
    }));
  };

  const toggleNotifyUser = (id: string) => {
    setF((prev) => ({
      ...prev,
      notifyUserIds: prev.notifyUserIds.includes(id)
        ? prev.notifyUserIds.filter((x) => x !== id)
        : [...prev.notifyUserIds, id],
    }));
  };

  const isCatchAll =
    !f.severities.length &&
    !f.activityTypes.trim() &&
    !f.alertClasses.trim() &&
    !f.sourceTypes.trim() &&
    !f.keywords.trim() &&
    !f.organizationIds.length &&
    !f.messagePattern.trim();

  const canSave = f.name.trim().length > 0 && !patternError && !saving;

  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        id="rule-editor-cancel"
        type="button"
        variant="outline"
        onClick={onClose}
        disabled={saving}
      >
        {t("integrations.rmm.alertAutomation.actions.cancel")}
      </Button>
      <Button
        id="rule-editor-save"
        type="button"
        onClick={onSave}
        disabled={!canSave}
      >
        {saving ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            {t("integrations.rmm.alertAutomation.actions.saving")}
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            {t("integrations.rmm.alertAutomation.actions.saveRule")}
          </>
        )}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      className="max-w-2xl"
      footer={footer}
    >
      <div className="space-y-5">
        {/* Basic fields */}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rule-name">
              {t("integrations.rmm.alertAutomation.fields.nameRequired")}
            </Label>
            <Input
              id="rule-name"
              value={f.name}
              onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
              placeholder={t(
                "integrations.rmm.alertAutomation.fields.ruleName",
              )}
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule-description">
              {t("integrations.rmm.alertAutomation.fields.description")}
            </Label>
            <Input
              id="rule-description"
              value={f.description}
              onChange={(e) =>
                setF((p) => ({ ...p, description: e.target.value }))
              }
              placeholder={t(
                "integrations.rmm.alertAutomation.fields.optionalDescription",
              )}
              disabled={saving}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="rule-active"
              checked={f.isActive}
              onCheckedChange={(v) => setF((p) => ({ ...p, isActive: v }))}
              disabled={saving}
            />
            <Label htmlFor="rule-active">
              {t("integrations.rmm.alertAutomation.fields.active")}
            </Label>
          </div>
        </div>

        {/* Match section */}
        <div className="rounded-md border p-4 space-y-4">
          <div className="text-sm font-semibold">
            {t("integrations.rmm.alertAutomation.rules.matchConditions")}
          </div>
          {isCatchAll && (
            <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
              {t("integrations.rmm.alertAutomation.rules.catchAllHelp")}
            </div>
          )}

          <div className="space-y-1">
            <Label>
              {t("integrations.rmm.alertAutomation.rules.severities")}
            </Label>
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((s) => (
                <Checkbox
                  key={s}
                  id={`rule-severity-${s}`}
                  label={t(`integrations.rmm.alertAutomation.severities.${s}`)}
                  checked={f.severities.includes(s)}
                  onChange={() => toggleSeverity(s)}
                  disabled={saving}
                  containerClassName=""
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rule-activity-types">
                {t("integrations.rmm.alertAutomation.rules.activityTypes")}
              </Label>
              <Input
                id="rule-activity-types"
                value={f.activityTypes}
                onChange={(e) =>
                  setF((p) => ({ ...p, activityTypes: e.target.value }))
                }
                placeholder={t(
                  "integrations.rmm.alertAutomation.rules.activityTypesPlaceholder",
                )}
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-alert-classes">
                {t("integrations.rmm.alertAutomation.rules.alertClasses")}
              </Label>
              <Input
                id="rule-alert-classes"
                value={f.alertClasses}
                onChange={(e) =>
                  setF((p) => ({ ...p, alertClasses: e.target.value }))
                }
                placeholder={t(
                  "integrations.rmm.alertAutomation.fields.commaSeparated",
                )}
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-source-types">
                {t("integrations.rmm.alertAutomation.rules.sourceTypes")}
              </Label>
              <Input
                id="rule-source-types"
                value={f.sourceTypes}
                onChange={(e) =>
                  setF((p) => ({ ...p, sourceTypes: e.target.value }))
                }
                placeholder={t(
                  "integrations.rmm.alertAutomation.fields.commaSeparated",
                )}
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-keywords">
                {t("integrations.rmm.alertAutomation.rules.keywords")}
              </Label>
              <Input
                id="rule-keywords"
                value={f.keywords}
                onChange={(e) =>
                  setF((p) => ({ ...p, keywords: e.target.value }))
                }
                placeholder={t(
                  "integrations.rmm.alertAutomation.fields.commaSeparated",
                )}
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-message-pattern">
              {t("integrations.rmm.alertAutomation.rules.messagePattern")}
            </Label>
            <Input
              id="rule-message-pattern"
              value={f.messagePattern}
              onChange={(e) => {
                setF((p) => ({ ...p, messagePattern: e.target.value }));
                validatePattern(e.target.value);
              }}
              placeholder={t(
                "integrations.rmm.alertAutomation.rules.messagePatternPlaceholder",
              )}
              disabled={saving}
            />
            {patternError && (
              <div className="text-xs text-destructive">{patternError}</div>
            )}
          </div>

          {formOptions?.organizations?.length ? (
            <div className="space-y-1">
              <Label>
                {t(
                  "integrations.rmm.alertAutomation.rules.organizationsFilter",
                )}
              </Label>
              <div className="max-h-36 overflow-y-auto space-y-1 rounded border p-2">
                {formOptions.organizations.map((org) => (
                  <Checkbox
                    key={org.external_organization_id}
                    id={`rule-org-${org.external_organization_id}`}
                    label={
                      org.external_organization_name ||
                      org.external_organization_id
                    }
                    checked={f.organizationIds.includes(
                      org.external_organization_id,
                    )}
                    onChange={() => toggleOrgId(org.external_organization_id)}
                    disabled={saving}
                    containerClassName=""
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Actions section */}
        <div className="rounded-md border p-4 space-y-4">
          <div className="text-sm font-semibold">
            {t("integrations.rmm.alertAutomation.rules.actions")}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="rule-create-ticket"
              checked={f.createTicket}
              onCheckedChange={(v) => setF((p) => ({ ...p, createTicket: v }))}
              disabled={saving}
            />
            <Label htmlFor="rule-create-ticket">
              {t("integrations.rmm.alertAutomation.rules.createTicket")}
            </Label>
          </div>

          {f.createTicket && (
            <div className="space-y-3 pl-2 border-l-2 border-border/40">
              <div className="space-y-1">
                <Label htmlFor="rule-board">
                  {t("integrations.rmm.alertAutomation.rules.board")}
                </Label>
                <CustomSelect
                  id="rule-board"
                  value={f.boardId}
                  onValueChange={(v) =>
                    setF((p) => ({ ...p, boardId: v, autoResolveStatusId: "" }))
                  }
                  options={[
                    {
                      value: "",
                      label: t(
                        "integrations.rmm.alertAutomation.rules.defaultBoard",
                      ),
                    },
                    ...(formOptions?.boards ?? []).map((b) => ({
                      value: b.board_id,
                      label: b.board_name,
                    })),
                  ]}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-priority">
                  {t("integrations.rmm.alertAutomation.rules.priorityOverride")}
                </Label>
                <CustomSelect
                  id="rule-priority"
                  value={f.priorityOverride}
                  onValueChange={(v) =>
                    setF((p) => ({ ...p, priorityOverride: v }))
                  }
                  options={[
                    {
                      value: "",
                      label: t(
                        "integrations.rmm.alertAutomation.rules.mapFromSeverity",
                      ),
                    },
                    ...(formOptions?.priorities ?? []).map((p) => ({
                      value: p.priority_id,
                      label: p.priority_name,
                    })),
                  ]}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-assign-user">
                  {t("integrations.rmm.alertAutomation.rules.assignToUser")}
                </Label>
                <CustomSelect
                  id="rule-assign-user"
                  value={f.assignToUserId}
                  onValueChange={(v) =>
                    setF((p) => ({ ...p, assignToUserId: v }))
                  }
                  options={[
                    {
                      value: "",
                      label: t(
                        "integrations.rmm.alertAutomation.rules.unassigned",
                      ),
                    },
                    ...(formOptions?.users ?? []).map((u) => ({
                      value: u.user_id,
                      label:
                        `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() ||
                        u.email,
                    })),
                  ]}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-title-template">
                  {t("integrations.rmm.alertAutomation.rules.titleTemplate")}
                </Label>
                <Input
                  id="rule-title-template"
                  value={f.titleTemplate}
                  onChange={(e) =>
                    setF((p) => ({ ...p, titleTemplate: e.target.value }))
                  }
                  placeholder={t(
                    "integrations.rmm.alertAutomation.rules.titleTemplatePlaceholder",
                  )}
                  disabled={saving}
                />
                <div className="text-xs text-muted-foreground">
                  {t("integrations.rmm.alertAutomation.rules.placeholders")}:{" "}
                  {"{{device}}"}, {"{{message}}"}, {"{{severity}}"},{" "}
                  {"{{organization}}"}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-desc-template">
                  {t(
                    "integrations.rmm.alertAutomation.rules.descriptionTemplate",
                  )}
                </Label>
                <Input
                  id="rule-desc-template"
                  value={f.descriptionTemplate}
                  onChange={(e) =>
                    setF((p) => ({ ...p, descriptionTemplate: e.target.value }))
                  }
                  placeholder={t(
                    "integrations.rmm.alertAutomation.rules.descriptionTemplatePlaceholder",
                  )}
                  disabled={saving}
                />
                <div className="text-xs text-muted-foreground">
                  {t("integrations.rmm.alertAutomation.rules.placeholders")}:{" "}
                  {"{{device}}"}, {"{{message}}"}, {"{{severity}}"},{" "}
                  {"{{organization}}"}
                </div>
              </div>

              {formOptions?.users?.length ? (
                <div className="space-y-1">
                  <Label>
                    {t("integrations.rmm.alertAutomation.rules.notifyUsers")}
                  </Label>
                  <div className="max-h-28 overflow-y-auto space-y-1 rounded border p-2">
                    {formOptions.users.map((u) => (
                      <Checkbox
                        key={u.user_id}
                        id={`rule-notify-user-${u.user_id}`}
                        label={
                          `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() ||
                          u.email
                        }
                        checked={f.notifyUserIds.includes(u.user_id)}
                        onChange={() => toggleNotifyUser(u.user_id)}
                        disabled={saving}
                        containerClassName=""
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id="rule-auto-resolve"
              checked={f.autoResolveTicket}
              onCheckedChange={(v) =>
                setF((p) => ({ ...p, autoResolveTicket: v }))
              }
              disabled={saving}
            />
            <Label htmlFor="rule-auto-resolve">
              {t("integrations.rmm.alertAutomation.rules.autoResolve")}
            </Label>
          </div>

          {f.autoResolveTicket && (
            <div className="space-y-1 pl-2 border-l-2 border-border/40">
              <Label htmlFor="rule-resolve-status">
                {t("integrations.rmm.alertAutomation.rules.resolveStatus")}
              </Label>
              <CustomSelect
                id="rule-resolve-status"
                value={f.autoResolveStatusId}
                onValueChange={(v) =>
                  setF((p) => ({ ...p, autoResolveStatusId: v }))
                }
                options={[
                  {
                    value: "",
                    label: t(
                      "integrations.rmm.alertAutomation.rules.defaultClosedStatus",
                    ),
                  },
                  ...(formOptions?.closedStatuses ?? [])
                    .filter((s) =>
                      f.boardId ? s.board_id === f.boardId : s.board_id == null,
                    )
                    .map((s) => ({ value: s.status_id, label: s.name })),
                ]}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id="rule-reset-on-close"
              checked={f.resetAlertOnTicketClose}
              onCheckedChange={(v) =>
                setF((p) => ({ ...p, resetAlertOnTicketClose: v }))
              }
              disabled={saving}
            />
            <Label htmlFor="rule-reset-on-close">
              {t("integrations.rmm.alertAutomation.rules.resetOnClose")}
            </Label>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Window editor dialog
// ---------------------------------------------------------------------------

interface WindowEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  formState: WindowFormState;
  setFormState: React.Dispatch<React.SetStateAction<WindowFormState>>;
  onSave: () => Promise<void>;
  saving: boolean;
  clients: IClient[];
  clientsLoading: boolean;
  clientFilterState: "all" | "active" | "inactive";
  setClientFilterState: React.Dispatch<
    React.SetStateAction<"all" | "active" | "inactive">
  >;
  clientTypeFilter: "all" | "company" | "individual";
  setClientTypeFilter: React.Dispatch<
    React.SetStateAction<"all" | "company" | "individual">
  >;
}

function WindowEditorDialog({
  isOpen,
  onClose,
  title,
  formState: f,
  setFormState: setF,
  onSave,
  saving,
  clients,
  clientsLoading,
  clientFilterState,
  setClientFilterState,
  clientTypeFilter,
  setClientTypeFilter,
}: WindowEditorDialogProps) {
  const { t } = useTranslation("msp/integrations");
  const toggleDay = (d: number) => {
    setF((prev) => ({
      ...prev,
      days: prev.days.includes(d)
        ? prev.days.filter((x) => x !== d)
        : [...prev.days, d].sort((a, b) => a - b),
    }));
  };

  const endsCrossesMidnight =
    f.scheduleType === "weekly" &&
    f.startTime &&
    f.endTime &&
    f.endTime <= f.startTime;

  const canSave =
    f.name.trim().length > 0 &&
    !saving &&
    (f.scheduleType === "onetime"
      ? Boolean(f.startsAt && f.endsAt)
      : f.days.length > 0 && Boolean(f.startTime && f.endTime));

  const footer = (
    <div className="flex justify-end gap-2">
      <Button
        id="window-editor-cancel"
        type="button"
        variant="outline"
        onClick={onClose}
        disabled={saving}
      >
        {t("integrations.rmm.alertAutomation.actions.cancel")}
      </Button>
      <Button
        id="window-editor-save"
        type="button"
        onClick={onSave}
        disabled={!canSave}
      >
        {saving ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            {t("integrations.rmm.alertAutomation.actions.saving")}
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            {t("integrations.rmm.alertAutomation.actions.saveWindow")}
          </>
        )}
      </Button>
    </div>
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} className="max-w-xl" footer={footer} allowOverflow>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="win-name">
            {t("integrations.rmm.alertAutomation.fields.nameRequired")}
          </Label>
          <Input
            id="win-name"
            value={f.name}
            onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
            placeholder={t(
              "integrations.rmm.alertAutomation.fields.windowName",
            )}
            disabled={saving}
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="win-active"
            checked={f.isActive}
            onCheckedChange={(v) => setF((p) => ({ ...p, isActive: v }))}
            disabled={saving}
          />
          <Label htmlFor="win-active">
            {t("integrations.rmm.alertAutomation.fields.active")}
          </Label>
        </div>

        {/* Scope */}
        <div className="rounded-md border p-3 space-y-3">
          <div className="text-sm font-semibold">
            {t("integrations.rmm.alertAutomation.scope.title")}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="win-scope-integration"
              checked={f.scopeThisIntegration}
              onCheckedChange={(v) =>
                setF((p) => ({ ...p, scopeThisIntegration: v }))
              }
              disabled={saving}
            />
            <Label htmlFor="win-scope-integration">
              {t("integrations.rmm.alertAutomation.scope.onlyThisIntegration")}
            </Label>
          </div>
          <div className="text-xs text-muted-foreground">
            {f.scopeThisIntegration
              ? t("integrations.rmm.alertAutomation.scope.thisIntegrationHelp")
              : t("integrations.rmm.alertAutomation.scope.allRmmHelp")}
          </div>

          <div className="space-y-1">
            <Label>
              {t("integrations.rmm.alertAutomation.scope.clientOptional")}
            </Label>
            <ClientPicker
              id="win-client-picker"
              clients={clients}
              selectedClientId={f.clientId}
              onSelect={(id) => setF((p) => ({ ...p, clientId: id }))}
              filterState={clientFilterState}
              onFilterStateChange={setClientFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
              placeholder={
                clientsLoading
                  ? t("integrations.rmm.alertAutomation.scope.loadingClients")
                  : t("integrations.rmm.alertAutomation.scope.allClients")
              }
              fitContent
              triggerVariant="outline"
              triggerSize="sm"
            />
          </div>
        </div>

        {/* Schedule type */}
        <div className="space-y-2">
          <Label>{t("integrations.rmm.alertAutomation.schedule.type")}</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                checked={f.scheduleType === "onetime"}
                onChange={() =>
                  setF((p) => ({ ...p, scheduleType: "onetime" }))
                }
                disabled={saving}
              />
              {t("integrations.rmm.alertAutomation.schedule.oneOff")}
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                checked={f.scheduleType === "weekly"}
                onChange={() => setF((p) => ({ ...p, scheduleType: "weekly" }))}
                disabled={saving}
              />
              {t("integrations.rmm.alertAutomation.schedule.weeklyRecurring")}
            </label>
          </div>
        </div>

        {f.scheduleType === "onetime" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="win-starts-at">
                {t("integrations.rmm.alertAutomation.schedule.startsAt")}
              </Label>
              <DateTimePicker
                id="win-starts-at"
                label={t("integrations.rmm.alertAutomation.schedule.startsAt")}
                placeholder={t(
                  "integrations.rmm.alertAutomation.schedule.startsAt",
                )}
                clearable
                className="w-full"
                value={dateTimeFromString(f.startsAt)}
                onChange={(date) =>
                  setF((p) => ({ ...p, startsAt: dateTimeToString(date) }))
                }
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="win-ends-at">
                {t("integrations.rmm.alertAutomation.schedule.endsAt")}
              </Label>
              <DateTimePicker
                id="win-ends-at"
                label={t("integrations.rmm.alertAutomation.schedule.endsAt")}
                placeholder={t(
                  "integrations.rmm.alertAutomation.schedule.endsAt",
                )}
                clearable
                className="w-full"
                value={dateTimeFromString(f.endsAt)}
                onChange={(date) =>
                  setF((p) => ({ ...p, endsAt: dateTimeToString(date) }))
                }
                disabled={saving}
              />
            </div>
          </div>
        )}

        {f.scheduleType === "weekly" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>
                {t("integrations.rmm.alertAutomation.schedule.days")}
              </Label>
              <div className="flex flex-wrap gap-2">
                {DAY_KEYS.map((dayKey, idx) => (
                  <Checkbox
                    key={idx}
                    id={`rule-day-${idx}`}
                    label={t(`integrations.rmm.alertAutomation.days.${dayKey}`)}
                    checked={f.days.includes(idx)}
                    onChange={() => toggleDay(idx)}
                    disabled={saving}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="win-start-time">
                  {t("integrations.rmm.alertAutomation.schedule.startTime")}
                </Label>
                <TimePicker
                  id="win-start-time"
                  value={f.startTime}
                  onChange={(startTime) => setF((p) => ({ ...p, startTime }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="win-end-time">
                  {t("integrations.rmm.alertAutomation.schedule.endTime")}
                </Label>
                <TimePicker
                  id="win-end-time"
                  value={f.endTime}
                  onChange={(endTime) => setF((p) => ({ ...p, endTime }))}
                  disabled={saving}
                />
              </div>
            </div>

            {endsCrossesMidnight && (
              <div className="text-xs text-muted-foreground">
                {t("integrations.rmm.alertAutomation.schedule.crossesMidnight")}
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="win-timezone">
                {t("integrations.rmm.alertAutomation.schedule.timezone")}
              </Label>
              <Input
                id="win-timezone"
                value={f.timezone}
                onChange={(e) =>
                  setF((p) => ({ ...p, timezone: e.target.value }))
                }
                placeholder="America/New_York"
                disabled={saving}
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const POLLING_PROVIDERS = new Set(["ninjaone", "tacticalrmm"]);

export function RmmAlertAutomationSettings({
  integrationId,
  provider,
}: RmmAlertAutomationSettingsProps) {
  const { toast } = useToast();
  const { t } = useTranslation("msp/integrations");

  // ── loading / error state ──────────────────────────────────────────────────
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // ── alert rules ───────────────────────────────────────────────────────────
  const [rules, setRules] = React.useState<RmmAlertRuleRow[]>([]);
  const [formOptions, setFormOptions] =
    React.useState<RmmAlertRuleFormOptions | null>(null);

  const [ruleDialogOpen, setRuleDialogOpen] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState<RmmAlertRuleRow | null>(
    null,
  );
  const [ruleForm, setRuleForm] =
    React.useState<RuleFormState>(defaultRuleForm);
  const [savingRule, setSavingRule] = React.useState(false);

  const [deleteConfirmRuleId, setDeleteConfirmRuleId] = React.useState<
    string | null
  >(null);
  const [deletingRule, setDeletingRule] = React.useState(false);

  // ── maintenance windows ───────────────────────────────────────────────────
  const [windows, setWindows] = React.useState<RmmMaintenanceWindowRow[]>([]);
  const [windowDialogOpen, setWindowDialogOpen] = React.useState(false);
  const [editingWindow, setEditingWindow] =
    React.useState<RmmMaintenanceWindowRow | null>(null);
  const [windowForm, setWindowForm] = React.useState<WindowFormState>(() =>
    defaultWindowForm(integrationId),
  );
  const [savingWindow, setSavingWindow] = React.useState(false);
  const [deleteConfirmWindowId, setDeleteConfirmWindowId] = React.useState<
    string | null
  >(null);
  const [deletingWindow, setDeletingWindow] = React.useState(false);

  const [clients, setClients] = React.useState<IClient[]>([]);
  const [clientsLoading, setClientsLoading] = React.useState(false);
  const [clientFilterState, setClientFilterState] = React.useState<
    "all" | "active" | "inactive"
  >("active");
  const [clientTypeFilter, setClientTypeFilter] = React.useState<
    "all" | "company" | "individual"
  >("all");

  // ── polling (providers with a reconciliation fetcher) ────────────────────
  const [pollingEnabled, setPollingEnabled] = React.useState(true);
  const [pollingInterval, setPollingInterval] = React.useState(15);
  const [pollingLastAt, setPollingLastAt] = React.useState<string | null>(null);
  const [savingPolling, setSavingPolling] = React.useState(false);

  // ── load ──────────────────────────────────────────────────────────────────
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loads: Promise<unknown>[] = [
        listRmmAlertRules({ integrationId }),
        listRmmMaintenanceWindows({ integrationId }),
        getRmmAlertRuleFormOptions({ integrationId }),
      ];
      if (POLLING_PROVIDERS.has(provider)) {
        loads.push(getRmmAlertPollingSettings({ integrationId }));
      }
      const results = await Promise.all(loads);

      const rulesRes = results[0] as Awaited<
        ReturnType<typeof listRmmAlertRules>
      >;
      const windowsRes = results[1] as Awaited<
        ReturnType<typeof listRmmMaintenanceWindows>
      >;
      const optionsRes = results[2] as Awaited<
        ReturnType<typeof getRmmAlertRuleFormOptions>
      >;

      if (rulesRes.success)
        setRules((rulesRes.data ?? []) as RmmAlertRuleRow[]);
      else
        setError(
          actionResultError(rulesRes) ??
            t("integrations.rmm.alertAutomation.errors.loadRules"),
        );

      if (windowsRes.success)
        setWindows((windowsRes.data ?? []) as RmmMaintenanceWindowRow[]);

      if (optionsRes.success) setFormOptions(optionsRes.data ?? null);

      if (POLLING_PROVIDERS.has(provider)) {
        const pollingRes = results[3] as Awaited<
          ReturnType<typeof getRmmAlertPollingSettings>
        >;
        if (pollingRes.success && pollingRes.data) {
          setPollingEnabled(pollingRes.data.enabled);
          setPollingInterval(pollingRes.data.intervalMinutes);
          setPollingLastAt(pollingRes.data.lastPolledAt);
        }
      }
    } catch (e) {
      console.error("Failed to load alert automation settings:", e);
      setError(t("integrations.rmm.alertAutomation.errors.loadSettings"));
    } finally {
      setLoading(false);
    }
  }, [integrationId, provider, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Load clients for window scope picker
  React.useEffect(() => {
    const run = async () => {
      setClientsLoading(true);
      try {
        const data = await getIntegrationClients(true);
        setClients(data as IClient[]);
      } catch {
        setClients([]);
      } finally {
        setClientsLoading(false);
      }
    };
    void run();
  }, []);

  // ── rule CRUD ─────────────────────────────────────────────────────────────
  const openAddRule = () => {
    setEditingRule(null);
    setRuleForm(defaultRuleForm());
    setRuleDialogOpen(true);
  };

  const openEditRule = (rule: RmmAlertRuleRow) => {
    setEditingRule(rule);
    setRuleForm(ruleToForm(rule));
    setRuleDialogOpen(true);
  };

  const handleSaveRule = async () => {
    setSavingRule(true);
    try {
      const { conditions, actions } = formToRuleInput(ruleForm);
      let res;
      if (editingRule) {
        res = await updateRmmAlertRule({
          ruleId: editingRule.rule_id,
          name: ruleForm.name,
          description: ruleForm.description || undefined,
          isActive: ruleForm.isActive,
          conditions,
          actions,
        });
      } else {
        res = await createRmmAlertRule({
          integrationId,
          name: ruleForm.name,
          description: ruleForm.description || undefined,
          isActive: ruleForm.isActive,
          conditions,
          actions,
        });
      }
      if (!res.success) {
        toast({
          title: t("integrations.rmm.alertAutomation.toasts.saveFailed"),
          description:
            actionResultError(res) ??
            t("integrations.rmm.alertAutomation.errors.unknown"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: editingRule
          ? t("integrations.rmm.alertAutomation.toasts.ruleUpdated")
          : t("integrations.rmm.alertAutomation.toasts.ruleCreated"),
        description: t(
          "integrations.rmm.alertAutomation.toasts.namedItemSaved",
          { name: ruleForm.name },
        ),
      });
      setRuleDialogOpen(false);
      await load();
    } finally {
      setSavingRule(false);
    }
  };

  const handleToggleRuleActive = async (
    rule: RmmAlertRuleRow,
    isActive: boolean,
  ) => {
    const res = await updateRmmAlertRule({ ruleId: rule.rule_id, isActive });
    if (!res.success) {
      toast({
        title: t("integrations.rmm.alertAutomation.toasts.updateFailed"),
        description:
          actionResultError(res) ??
          t("integrations.rmm.alertAutomation.errors.unknown"),
        variant: "destructive",
      });
      return;
    }
    setRules((prev) =>
      prev.map((r) =>
        r.rule_id === rule.rule_id ? { ...r, is_active: isActive } : r,
      ),
    );
  };

  const handleDeleteRule = async (ruleId: string) => {
    setDeletingRule(true);
    try {
      const res = await deleteRmmAlertRule({ ruleId });
      if (!res.success) {
        toast({
          title: t("integrations.rmm.alertAutomation.toasts.deleteFailed"),
          description:
            actionResultError(res) ??
            t("integrations.rmm.alertAutomation.errors.unknown"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("integrations.rmm.alertAutomation.toasts.ruleDeleted"),
      });
      setDeleteConfirmRuleId(null);
      await load();
    } finally {
      setDeletingRule(false);
    }
  };

  const handleMoveRule = async (ruleId: string, direction: "up" | "down") => {
    const idx = rules.findIndex((r) => r.rule_id === ruleId);
    if (idx < 0) return;
    const newRules = [...rules];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newRules.length) return;
    [newRules[idx], newRules[swapIdx]] = [newRules[swapIdx], newRules[idx]];
    setRules(newRules);
    const res = await reorderRmmAlertRules({
      integrationId,
      orderedRuleIds: newRules.map((r) => r.rule_id),
    });
    if (!res.success) {
      toast({
        title: t("integrations.rmm.alertAutomation.toasts.reorderFailed"),
        description:
          actionResultError(res) ??
          t("integrations.rmm.alertAutomation.errors.unknown"),
        variant: "destructive",
      });
      await load();
    }
  };

  // ── window CRUD ───────────────────────────────────────────────────────────
  const openAddWindow = () => {
    setEditingWindow(null);
    setWindowForm(defaultWindowForm(integrationId));
    setWindowDialogOpen(true);
  };

  const openEditWindow = (w: RmmMaintenanceWindowRow) => {
    setEditingWindow(w);
    setWindowForm(windowToForm(w, integrationId));
    setWindowDialogOpen(true);
  };

  const handleSaveWindow = async () => {
    setSavingWindow(true);
    try {
      const input = formToWindowInput(windowForm, integrationId);
      let res;
      if (editingWindow) {
        res = await updateRmmMaintenanceWindow({
          windowId: editingWindow.window_id,
          ...input,
        });
      } else {
        res = await createRmmMaintenanceWindow(input);
      }
      if (!res.success) {
        toast({
          title: t("integrations.rmm.alertAutomation.toasts.saveFailed"),
          description:
            actionResultError(res) ??
            t("integrations.rmm.alertAutomation.errors.unknown"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: editingWindow
          ? t("integrations.rmm.alertAutomation.toasts.windowUpdated")
          : t("integrations.rmm.alertAutomation.toasts.windowCreated"),
        description: t(
          "integrations.rmm.alertAutomation.toasts.namedItemSaved",
          { name: windowForm.name },
        ),
      });
      setWindowDialogOpen(false);
      await load();
    } finally {
      setSavingWindow(false);
    }
  };

  const handleToggleWindowActive = async (
    w: RmmMaintenanceWindowRow,
    isActive: boolean,
  ) => {
    const input = formToWindowInput(
      windowToForm(w, integrationId),
      integrationId,
    );
    const res = await updateRmmMaintenanceWindow({
      windowId: w.window_id,
      ...input,
      isActive,
    });
    if (!res.success) {
      toast({
        title: t("integrations.rmm.alertAutomation.toasts.updateFailed"),
        description:
          actionResultError(res) ??
          t("integrations.rmm.alertAutomation.errors.unknown"),
        variant: "destructive",
      });
      return;
    }
    setWindows((prev) =>
      prev.map((x) =>
        x.window_id === w.window_id ? { ...x, is_active: isActive } : x,
      ),
    );
  };

  const handleDeleteWindow = async (windowId: string) => {
    setDeletingWindow(true);
    try {
      const res = await deleteRmmMaintenanceWindow({ windowId });
      if (!res.success) {
        toast({
          title: t("integrations.rmm.alertAutomation.toasts.deleteFailed"),
          description:
            actionResultError(res) ??
            t("integrations.rmm.alertAutomation.errors.unknown"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("integrations.rmm.alertAutomation.toasts.windowDeleted"),
      });
      setDeleteConfirmWindowId(null);
      await load();
    } finally {
      setDeletingWindow(false);
    }
  };

  // ── polling ───────────────────────────────────────────────────────────────
  const handleSavePolling = async () => {
    if (pollingInterval < 5 || pollingInterval > 60) {
      toast({
        title: t("integrations.rmm.alertAutomation.toasts.invalidInterval"),
        description: t(
          "integrations.rmm.alertAutomation.polling.intervalError",
        ),
        variant: "destructive",
      });
      return;
    }
    setSavingPolling(true);
    try {
      const res = await updateRmmAlertPollingSettings({
        integrationId,
        enabled: pollingEnabled,
        intervalMinutes: pollingInterval,
      });
      if (!res.success) {
        toast({
          title: t("integrations.rmm.alertAutomation.toasts.saveFailed"),
          description:
            actionResultError(res) ??
            t("integrations.rmm.alertAutomation.errors.unknown"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("integrations.rmm.alertAutomation.toasts.pollingSaved"),
      });
    } finally {
      setSavingPolling(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        {t("integrations.rmm.alertAutomation.loading")}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6" id={`rmm-alert-automation-${provider}`}>
      <div>
        <h2 className="text-lg font-semibold">
          {t("integrations.rmm.alertAutomation.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("integrations.rmm.alertAutomation.description")}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Alert Rules card ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {t("integrations.rmm.alertAutomation.rules.title")}
              </CardTitle>
              <CardDescription>
                {t("integrations.rmm.alertAutomation.rules.description")}
              </CardDescription>
            </div>
            <Button
              id={`${provider}-add-alert-rule`}
              type="button"
              size="sm"
              onClick={openAddRule}
              disabled={loading || !formOptions}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("integrations.rmm.alertAutomation.actions.addRule")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("integrations.rmm.alertAutomation.rules.empty")}
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule, idx) => (
                <div
                  key={rule.rule_id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 rounded border p-3"
                >
                  {/* Reorder */}
                  <div className="flex flex-col gap-0.5">
                    <Button
                      id={`rule-move-up-${rule.rule_id}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleMoveRule(rule.rule_id, "up")}
                      disabled={idx === 0 || loading}
                      aria-label={t(
                        "integrations.rmm.alertAutomation.actions.moveUp",
                      )}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      id={`rule-move-down-${rule.rule_id}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleMoveRule(rule.rule_id, "down")}
                      disabled={idx === rules.length - 1 || loading}
                      aria-label={t(
                        "integrations.rmm.alertAutomation.actions.moveDown",
                      )}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Name + chips */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {rule.name}
                    </div>
                    {rule.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {rule.description}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {ruleSummaryChips(rule, t).map((chip) => (
                        <Badge
                          key={chip}
                          variant="secondary"
                          className="text-xs"
                        >
                          {chip}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Active toggle */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      id={`rule-active-${rule.rule_id}`}
                      checked={rule.is_active}
                      onCheckedChange={(v) => handleToggleRuleActive(rule, v)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {t("integrations.rmm.alertAutomation.fields.active")}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      id={`rule-edit-${rule.rule_id}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditRule(rule)}
                      disabled={!formOptions}
                      aria-label={t(
                        "integrations.rmm.alertAutomation.actions.editRule",
                      )}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {deleteConfirmRuleId === rule.rule_id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          id={`rule-delete-confirm-${rule.rule_id}`}
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteRule(rule.rule_id)}
                          disabled={deletingRule}
                        >
                          {deletingRule ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            t(
                              "integrations.rmm.alertAutomation.actions.confirm",
                            )
                          )}
                        </Button>
                        <Button
                          id={`rule-delete-cancel-${rule.rule_id}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteConfirmRuleId(null)}
                          disabled={deletingRule}
                        >
                          {t("integrations.rmm.alertAutomation.actions.cancel")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        id={`rule-delete-${rule.rule_id}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirmRuleId(rule.rule_id)}
                        aria-label={t(
                          "integrations.rmm.alertAutomation.actions.deleteRule",
                        )}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Maintenance Windows card ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {t("integrations.rmm.alertAutomation.windows.title")}
              </CardTitle>
              <CardDescription>
                {t("integrations.rmm.alertAutomation.windows.description")}
              </CardDescription>
            </div>
            <Button
              id={`${provider}-add-maintenance-window`}
              type="button"
              size="sm"
              onClick={openAddWindow}
              disabled={loading}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("integrations.rmm.alertAutomation.actions.addWindow")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {windows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("integrations.rmm.alertAutomation.windows.empty")}
            </div>
          ) : (
            <div className="space-y-2">
              {windows.map((w) => (
                <div
                  key={w.window_id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 rounded border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{w.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatWindowScope(w, integrationId, t)} ·{" "}
                      {formatWindowSchedule(w, t)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      id={`window-active-${w.window_id}`}
                      checked={w.is_active}
                      onCheckedChange={(v) => handleToggleWindowActive(w, v)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {t("integrations.rmm.alertAutomation.fields.active")}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      id={`window-edit-${w.window_id}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditWindow(w)}
                      aria-label={t(
                        "integrations.rmm.alertAutomation.actions.editWindow",
                      )}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {deleteConfirmWindowId === w.window_id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          id={`window-delete-confirm-${w.window_id}`}
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteWindow(w.window_id)}
                          disabled={deletingWindow}
                        >
                          {deletingWindow ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            t(
                              "integrations.rmm.alertAutomation.actions.confirm",
                            )
                          )}
                        </Button>
                        <Button
                          id={`window-delete-cancel-${w.window_id}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteConfirmWindowId(null)}
                          disabled={deletingWindow}
                        >
                          {t("integrations.rmm.alertAutomation.actions.cancel")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        id={`window-delete-${w.window_id}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirmWindowId(w.window_id)}
                        aria-label={t(
                          "integrations.rmm.alertAutomation.actions.deleteWindow",
                        )}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Alert Polling card (NinjaOne only) ───────────────────────────── */}
      {POLLING_PROVIDERS.has(provider) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("integrations.rmm.alertAutomation.polling.title")}
            </CardTitle>
            <CardDescription>
              {t("integrations.rmm.alertAutomation.polling.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Switch
                id={`${provider}-polling-enabled`}
                checked={pollingEnabled}
                onCheckedChange={setPollingEnabled}
                disabled={savingPolling}
              />
              <Label htmlFor={`${provider}-polling-enabled`}>
                {t("integrations.rmm.alertAutomation.polling.enabled")}
              </Label>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`${provider}-polling-interval`}>
                {t("integrations.rmm.alertAutomation.polling.interval")}
              </Label>
              <Input
                id={`${provider}-polling-interval`}
                type="number"
                min={5}
                max={60}
                value={pollingInterval}
                onChange={(e) => setPollingInterval(Number(e.target.value))}
                disabled={savingPolling}
                className="max-w-xs"
              />
              {(pollingInterval < 5 || pollingInterval > 60) && (
                <div className="text-xs text-destructive">
                  {t("integrations.rmm.alertAutomation.polling.intervalError")}
                </div>
              )}
            </div>

            {pollingLastAt && (
              <div className="text-xs text-muted-foreground">
                {t("integrations.rmm.alertAutomation.polling.lastPolled", {
                  time: new Date(pollingLastAt).toLocaleString(),
                })}
              </div>
            )}

            <Button
              id={`${provider}-save-polling`}
              type="button"
              onClick={handleSavePolling}
              disabled={
                savingPolling || pollingInterval < 5 || pollingInterval > 60
              }
            >
              {savingPolling ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t("integrations.rmm.alertAutomation.actions.saving")}
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {t("integrations.rmm.alertAutomation.actions.savePolling")}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Rule editor dialog ────────────────────────────────────────────── */}
      <RuleEditorDialog
        isOpen={ruleDialogOpen}
        onClose={() => setRuleDialogOpen(false)}
        title={
          editingRule
            ? t("integrations.rmm.alertAutomation.dialogs.editRule", {
                name: editingRule.name,
              })
            : t("integrations.rmm.alertAutomation.dialogs.addRule")
        }
        formState={ruleForm}
        setFormState={setRuleForm}
        onSave={handleSaveRule}
        saving={savingRule}
        formOptions={formOptions}
      />

      {/* ── Window editor dialog ──────────────────────────────────────────── */}
      <WindowEditorDialog
        isOpen={windowDialogOpen}
        onClose={() => setWindowDialogOpen(false)}
        title={
          editingWindow
            ? t("integrations.rmm.alertAutomation.dialogs.editWindow", {
                name: editingWindow.name,
              })
            : t("integrations.rmm.alertAutomation.dialogs.addWindow")
        }
        formState={windowForm}
        setFormState={setWindowForm}
        onSave={handleSaveWindow}
        saving={savingWindow}
        clients={clients}
        clientsLoading={clientsLoading}
        clientFilterState={clientFilterState}
        setClientFilterState={setClientFilterState}
        clientTypeFilter={clientTypeFilter}
        setClientTypeFilter={setClientTypeFilter}
      />
    </div>
  );
}

export default RmmAlertAutomationSettings;
