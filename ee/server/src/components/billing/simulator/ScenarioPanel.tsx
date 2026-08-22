"use client";

import React, { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@alga-psa/ui/components/Button";
import { DatePicker } from "@alga-psa/ui/components/DatePicker";
import { dateFromString, dateToString } from "@alga-psa/ui/lib/dateInput";
import { cn } from "@alga-psa/ui/lib/utils";
import { useFormatters, useTranslation } from "@alga-psa/ui/lib/i18n/client";
import type {
  ScenarioCatalogService,
  ScenarioAdjustment,
  ScenarioDiscount,
  ScenarioLine,
  ScenarioLineService,
  ScenarioPricingSchedule,
  ScenarioServiceConfig,
} from "@alga-psa/types";

interface ScenarioPanelProps {
  lines: ScenarioLine[];
  pristineLines: ScenarioLine[];
  availableServices: ScenarioCatalogService[];
  pricingSchedules: ScenarioPricingSchedule[];
  discounts: ScenarioDiscount[];
  adjustments: ScenarioAdjustment[];
  currencyCode: string;
  modifiedLineKeys: Set<string>;
  hasModifications: boolean;
  focusedLineKey: string | null;
  onRateChange: (
    lineKey: string,
    serviceId: string | null,
    configurationType:
      | ScenarioLineService["configuration"]["configuration_type"]
      | null,
    cents: number | null,
  ) => void;
  onResetAll: () => void;
  onLinesChange: (lines: ScenarioLine[]) => void;
  onPricingSchedulesChange: (schedules: ScenarioPricingSchedule[]) => void;
  onDiscountsChange: (discounts: ScenarioDiscount[]) => void;
  onAdjustmentsChange: (adjustments: ScenarioAdjustment[]) => void;
}

const TYPE_BADGE_CLASSES: Record<string, string> = {
  Fixed: "bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  Hourly: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
  Usage: "bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  Bucket:
    "chip-primary",
};

const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const { t } = useTranslation("msp/contracts");
  return (
    <span
      className={cn(
        "rounded px-1.5 py-px text-[10px] font-semibold lowercase tracking-wide",
        TYPE_BADGE_CLASSES[type] ??
          "bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-600))]",
      )}
    >
      {t(`contractSimulator.scenario.types.${type.toLowerCase()}`, {
        defaultValue: type,
      })}
    </span>
  );
};

interface InlineRateEditorProps {
  id: string;
  label: string;
  cents: number | null;
  suffix?: string;
  emptyLabel?: string;
  currencyCode: string;
  onCommit: (cents: number | null) => void;
}

/** Click-to-edit rate: text button that swaps to a number input, edited in dollars. */
const InlineRateEditor: React.FC<InlineRateEditorProps> = ({
  id,
  label,
  cents,
  suffix,
  emptyLabel,
  currencyCode,
  onCommit,
}) => {
  const { t } = useTranslation("msp/contracts");
  const { formatCurrency } = useFormatters();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const commit = () => {
    setEditing(false);
    if (text.trim() === "") {
      onCommit(null);
      return;
    }
    const parsed = Number.parseFloat(text);
    if (!Number.isNaN(parsed)) {
      onCommit(Math.round(parsed * 100));
    }
  };

  if (!editing) {
    return (
      <button
        id={id}
        type="button"
        aria-label={label}
        onClick={() => {
          setText(cents !== null ? (cents / 100).toFixed(2) : "");
          setEditing(true);
        }}
        className="ml-auto rounded border border-dashed border-transparent px-1 py-px font-mono text-xs text-[rgb(var(--color-text-800))] hover:border-[rgb(var(--color-primary-300))] hover:bg-[rgb(var(--color-primary-50))] dark:hover:bg-[rgb(var(--color-primary-400)/0.15)]"
      >
        {cents !== null
          ? formatCurrency(cents / 100, currencyCode)
          : (emptyLabel ??
            t("contractSimulator.scenario.catalogRate", {
              defaultValue: "Catalog rate",
            }))}
        {suffix && (
          <span className="text-[rgb(var(--color-text-400))]">{suffix}</span>
        )}
      </button>
    );
  }

  return (
    <span className="ml-auto inline-flex overflow-hidden rounded border border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-card))]">
      <input
        id={`${id}-input`}
        aria-label={label}
        type="number"
        step="0.01"
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setEditing(false);
        }}
        className="w-20 border-0 bg-transparent px-1 py-px text-right font-mono text-xs text-[rgb(var(--color-text-900))] outline-none"
      />
      {suffix && (
        <span className="border-l border-[rgb(var(--color-border-200))] px-1 py-px text-[10px] text-[rgb(var(--color-text-400))]">
          {suffix.replace("/", "")}
        </span>
      )}
    </span>
  );
};

const serviceRateEditor = (
  line: ScenarioLine,
  service: ScenarioLineService,
  currencyCode: string,
  onRateChange: ScenarioPanelProps["onRateChange"],
  label: string,
): React.ReactNode => {
  const configuration = service.configuration;
  if (configuration.configuration_type === "Hourly") {
    return (
      <InlineRateEditor
        id={`edit-rate-${line.key}-${service.service_id}`}
        label={label}
        cents={
          configuration.hourly_rate ??
          service.custom_rate ??
          service.default_rate
        }
        suffix="/hr"
        currencyCode={currencyCode}
        onCommit={(cents) =>
          onRateChange(line.key, service.service_id, "Hourly", cents)
        }
      />
    );
  }
  if (configuration.configuration_type === "Usage") {
    return (
      <InlineRateEditor
        id={`edit-rate-${line.key}-${service.service_id}`}
        label={label}
        cents={
          configuration.base_rate ?? service.custom_rate ?? service.default_rate
        }
        suffix={`/${configuration.unit_of_measure}`}
        currencyCode={currencyCode}
        onCommit={(cents) =>
          onRateChange(line.key, service.service_id, "Usage", cents)
        }
      />
    );
  }
  if (configuration.configuration_type === "Bucket") {
    return (
      <InlineRateEditor
        id={`edit-rate-${line.key}-${service.service_id}`}
        label={label}
        cents={configuration.overage_rate}
        suffix="/hr"
        currencyCode={currencyCode}
        onCommit={(cents) =>
          onRateChange(line.key, service.service_id, "Bucket", cents)
        }
      />
    );
  }
  return (
    <InlineRateEditor
      id={`edit-rate-${line.key}-${service.service_id}`}
      label={label}
      cents={
        configuration.base_rate ?? service.custom_rate ?? service.default_rate
      }
      currencyCode={currencyCode}
      onCommit={(cents) =>
        onRateChange(line.key, service.service_id, "Fixed", cents)
      }
    />
  );
};

function defaultConfiguration(
  type: ScenarioServiceConfig["configuration_type"],
): ScenarioServiceConfig {
  if (type === "Hourly") {
    return {
      configuration_type: "Hourly",
      hourly_rate: null,
      minimum_billable_time: 0,
      round_up_to_nearest: 0,
      user_type_rates: [],
    };
  }
  if (type === "Usage") {
    return {
      configuration_type: "Usage",
      unit_of_measure: "unit",
      enable_tiered_pricing: false,
      minimum_usage: null,
      base_rate: null,
      tiers: [],
    };
  }
  if (type === "Bucket") {
    return {
      configuration_type: "Bucket",
      total_minutes: 0,
      billing_period: "monthly",
      overage_rate: 0,
      allow_rollover: false,
    };
  }
  return { configuration_type: "Fixed", base_rate: null };
}

const fieldClass =
  "min-w-0 rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-2 py-1.5 text-xs text-[rgb(var(--color-text-800))]";
const fieldLabelClass =
  "flex min-w-0 flex-col gap-1 text-[11px] font-medium text-[rgb(var(--color-text-500))]";

const ScenarioPanel: React.FC<ScenarioPanelProps> = ({
  lines,
  pristineLines,
  availableServices,
  pricingSchedules,
  discounts,
  adjustments,
  currencyCode,
  modifiedLineKeys,
  hasModifications,
  focusedLineKey,
  onRateChange,
  onResetAll,
  onLinesChange,
  onPricingSchedulesChange,
  onDiscountsChange,
  onAdjustmentsChange,
}) => {
  const { t } = useTranslation("msp/contracts");
  const [expandedLineKeys, setExpandedLineKeys] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (!focusedLineKey) return;
    setExpandedLineKeys((previous) => {
      const next = new Set(previous);
      next.add(focusedLineKey);
      return next;
    });
    requestAnimationFrame(() => {
      document
        .getElementById(`scenario-line-${focusedLineKey}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [focusedLineKey]);

  const toggleLine = (lineKey: string) => {
    setExpandedLineKeys((previous) => {
      const next = new Set(previous);
      if (next.has(lineKey)) next.delete(lineKey);
      else next.add(lineKey);
      return next;
    });
  };

  const updateLine = (
    lineKey: string,
    update: (line: ScenarioLine) => void,
  ) => {
    const next = structuredClone(lines);
    const line = next.find((candidate) => candidate.key === lineKey);
    if (!line) return;
    update(line);
    onLinesChange(next);
  };

  const addLine = () => {
    const index = lines.length + 1;
    onLinesChange([
      ...lines,
      {
        key: `scenario-${Date.now()}-${index}`,
        origin_contract_line_id: null,
        contract_line_name: t("contractSimulator.scenario.newLineName", {
          defaultValue: "Scenario line {{number}}",
          number: index,
        }).replace("{{number}}", String(index)),
        contract_line_type: "Fixed",
        billing_frequency: "monthly",
        billing_timing: "advance",
        cadence_owner: "contract",
        custom_rate: null,
        enable_proration: false,
        location_id: null,
        enable_overtime: false,
        overtime_threshold: null,
        overtime_rate: null,
        services: [],
      },
    ]);
  };

  const addService = (lineKey: string, catalogId: string) => {
    const catalog = availableServices.find(
      (service) => service.service_id === catalogId,
    );
    const line = lines.find((candidate) => candidate.key === lineKey);
    if (!catalog || !line) return;
    const configType =
      catalog.item_kind === "product" ? "Fixed" : line.contract_line_type;
    updateLine(lineKey, (draft) => {
      if (
        draft.services.some(
          (service) =>
            service.service_id === catalogId &&
            service.configuration.configuration_type !== "Bucket",
        )
      )
        return;
      draft.services.push({
        configuration_id: `scenario-config-${Date.now()}`,
        service_id: catalog.service_id,
        service_name: catalog.service_name,
        quantity: 1,
        custom_rate: null,
        default_rate: catalog.currency_rate,
        legacy_default_rate: catalog.legacy_default_rate,
        service_quantity: 1,
        service_custom_rate: null,
        configuration_quantity: 1,
        configuration_custom_rate: null,
        tax_rate_id: catalog.tax_rate_id,
        item_kind: catalog.item_kind,
        is_license: catalog.is_license,
        configuration: defaultConfiguration(configType),
      });
    });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <div className="flex items-center gap-2 border-b border-[rgb(var(--color-border-200))] px-4 py-3">
        <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
          {t("contractSimulator.scenario.title", {
            defaultValue: "Contract changes",
          })}
        </h3>
        <span className="text-xs text-[rgb(var(--color-text-400))]">
          {t("contractSimulator.scenario.lineCount", {
            defaultValue: "{{count}} lines",
            count: lines.length,
          })}
        </span>
        <Button
          id="add-scenario-line-button"
          variant="outline"
          size="xs"
          onClick={addLine}
        >
          {t("contractSimulator.scenario.addLine", {
            defaultValue: "Add line",
          })}
        </Button>
        <Button
          id="reset-scenario-button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={onResetAll}
          disabled={!hasModifications}
        >
          {t("contractSimulator.scenario.resetAll", {
            defaultValue: "Reset all",
          })}
        </Button>
      </div>

      <div className="space-y-2 p-2">
        {lines.map((line) => {
          const modified = modifiedLineKeys.has(line.key);
          const expanded = expandedLineKeys.has(line.key);
          const pristine = pristineLines.find(
            (candidate) => candidate.key === line.key,
          );
          return (
            <div
              key={line.key}
              id={`scenario-line-${line.key}`}
              className={cn(
                "rounded-lg border p-2.5",
                modified
                  ? "border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.10)]"
                  : "border-[rgb(var(--color-border-200))]",
              )}
            >
              {!expanded && (
                <button
                  type="button"
                  aria-expanded={false}
                  onClick={() => toggleLine(line.key)}
                  className="flex w-full items-start gap-2 rounded-md bg-[rgb(var(--color-background))] px-2.5 py-2 text-left hover:bg-[rgb(var(--color-primary-50))]"
                >
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--color-text-500))]" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-xs font-semibold text-[rgb(var(--color-text-800))]">
                      {line.contract_line_name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[rgb(var(--color-text-500))]">
                      {t("contractSimulator.scenario.lineSummary", {
                        defaultValue:
                          "{{type}} · {{frequency}} · {{timing}} · {{services}}",
                        type: line.contract_line_type,
                        frequency: t(
                          `contractSimulator.scenario.frequencies.${line.billing_frequency}`,
                          { defaultValue: line.billing_frequency },
                        ),
                        timing:
                          line.billing_timing === "advance"
                            ? t("contractSimulator.scenario.timing.advance", {
                                defaultValue: "Bill in advance",
                              })
                            : t("contractSimulator.scenario.timing.arrears", {
                                defaultValue: "Bill in arrears",
                              }),
                        services:
                          line.services.length === 1
                            ? t("contractSimulator.scenario.oneService", {
                                defaultValue: "1 service",
                              })
                            : t("contractSimulator.scenario.serviceCount", {
                                defaultValue: "{{count}} services",
                                count: line.services.length,
                              }),
                      })}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-[rgb(var(--color-primary-600))]">
                    {t("contractSimulator.scenario.editDetails", {
                      defaultValue: "Edit rules",
                    })}
                  </span>
                </button>
              )}

              {expanded && (
                <>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-expanded={true}
                      aria-label={t(
                        "contractSimulator.scenario.collapseDetailsFor",
                        {
                          defaultValue: "Collapse details for {{line}}",
                          line: line.contract_line_name,
                        },
                      )}
                      onClick={() => toggleLine(line.key)}
                      className="rounded p-1 text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-primary-100))]"
                    >
                      <ChevronRight className="h-4 w-4 rotate-90" />
                    </button>
                    <input
                      aria-label={t(
                        "contractSimulator.scenario.fields.lineName",
                        { defaultValue: "Contract line name" },
                      )}
                      value={line.contract_line_name}
                      onChange={(event) =>
                        updateLine(line.key, (draft) => {
                          draft.contract_line_name = event.target.value;
                        })
                      }
                      className={`${fieldClass} min-w-0 flex-1 font-semibold`}
                    />
                    {modified && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--color-primary-500))]"
                        title={t("contractSimulator.scenario.modified", {
                          defaultValue: "Modified",
                        })}
                      />
                    )}
                    <Button
                      id={`reset-line-${line.key}`}
                      variant="ghost"
                      size="xs"
                      disabled={!modified}
                      onClick={() =>
                        onLinesChange(
                          pristine
                            ? lines.map((candidate) =>
                                candidate.key === line.key
                                  ? structuredClone(pristine)
                                  : candidate,
                              )
                            : lines.filter(
                                (candidate) => candidate.key !== line.key,
                              ),
                        )
                      }
                    >
                      {t("contractSimulator.scenario.resetLine", {
                        defaultValue: "Reset",
                      })}
                    </Button>
                    <Button
                      id={`remove-line-${line.key}`}
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        onLinesChange(
                          lines.filter(
                            (candidate) => candidate.key !== line.key,
                          ),
                        )
                      }
                    >
                      {t("contractSimulator.scenario.removeLine", {
                        defaultValue: "Remove",
                      })}
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <label className={fieldLabelClass}>
                      {t("contractSimulator.scenario.fields.lineType", {
                        defaultValue: "Line type",
                      })}
                      <select
                        aria-label={t(
                          "contractSimulator.scenario.fields.lineType",
                          {
                            defaultValue: "Line type",
                          },
                        )}
                        className={fieldClass}
                        value={line.contract_line_type}
                        onChange={(event) =>
                          updateLine(line.key, (draft) => {
                            const type = event.target
                              .value as ScenarioLine["contract_line_type"];
                            draft.contract_line_type = type;
                            draft.services = draft.services.map((service) =>
                              service.item_kind === "product" ||
                              service.configuration.configuration_type ===
                                "Bucket"
                                ? service
                                : {
                                    ...service,
                                    configuration: defaultConfiguration(type),
                                  },
                            );
                          })
                        }
                      >
                        <option value="Fixed">
                          {t("contractSimulator.scenario.types.fixed", {
                            defaultValue: "Fixed",
                          })}
                        </option>
                        <option value="Hourly">
                          {t("contractSimulator.scenario.types.hourly", {
                            defaultValue: "Hourly",
                          })}
                        </option>
                        <option value="Usage">
                          {t("contractSimulator.scenario.types.usage", {
                            defaultValue: "Usage",
                          })}
                        </option>
                      </select>
                    </label>
                    <label className={fieldLabelClass}>
                      {t("contractSimulator.scenario.fields.billingFrequency", {
                        defaultValue: "Billing frequency",
                      })}
                      <select
                        aria-label={t(
                          "contractSimulator.scenario.fields.billingFrequency",
                          {
                            defaultValue: "Billing frequency",
                          },
                        )}
                        className={fieldClass}
                        value={line.billing_frequency}
                        onChange={(event) =>
                          updateLine(line.key, (draft) => {
                            draft.billing_frequency = event.target.value;
                          })
                        }
                      >
                        {[
                          "monthly",
                          "quarterly",
                          "semi-annually",
                          "annually",
                        ].map((value) => (
                          <option key={value} value={value}>
                            {t(
                              `contractSimulator.scenario.frequencies.${value}`,
                              {
                                defaultValue: value,
                              },
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={fieldLabelClass}>
                      {t("contractSimulator.scenario.fields.billingTiming", {
                        defaultValue: "Billing timing",
                      })}
                      <select
                        aria-label={t(
                          "contractSimulator.scenario.fields.billingTiming",
                          {
                            defaultValue: "Billing timing",
                          },
                        )}
                        className={fieldClass}
                        value={line.billing_timing}
                        onChange={(event) =>
                          updateLine(line.key, (draft) => {
                            draft.billing_timing = event.target.value as
                              | "arrears"
                              | "advance";
                          })
                        }
                      >
                        <option value="advance">
                          {t("contractSimulator.scenario.timing.advance", {
                            defaultValue: "Bill in advance",
                          })}
                        </option>
                        <option value="arrears">
                          {t("contractSimulator.scenario.timing.arrears", {
                            defaultValue: "Bill in arrears",
                          })}
                        </option>
                      </select>
                    </label>
                    <label className={fieldLabelClass}>
                      {t("contractSimulator.scenario.fields.cadenceOwner", {
                        defaultValue: "Billing schedule",
                      })}
                      <select
                        aria-label={t(
                          "contractSimulator.scenario.fields.cadenceOwner",
                          {
                            defaultValue: "Cadence owner",
                          },
                        )}
                        className={fieldClass}
                        value={line.cadence_owner}
                        onChange={(event) =>
                          updateLine(line.key, (draft) => {
                            draft.cadence_owner = event.target.value as
                              | "client"
                              | "contract";
                          })
                        }
                      >
                        <option value="contract">
                          {t("contractSimulator.scenario.cadence.contract", {
                            defaultValue: "Use contract line schedule",
                          })}
                        </option>
                        <option value="client">
                          {t("contractSimulator.scenario.cadence.client", {
                            defaultValue: "Use client billing schedule",
                          })}
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-[rgb(var(--color-text-600))]">
                    <label>
                      <input
                        type="checkbox"
                        checked={line.enable_proration}
                        onChange={(event) =>
                          updateLine(line.key, (draft) => {
                            draft.enable_proration = event.target.checked;
                          })
                        }
                      />{" "}
                      {t("contractSimulator.scenario.proration", {
                        defaultValue: "proration",
                      })}
                    </label>
                    {line.contract_line_type === "Hourly" && (
                      <label>
                        <input
                          type="checkbox"
                          checked={line.enable_overtime}
                          onChange={(event) =>
                            updateLine(line.key, (draft) => {
                              draft.enable_overtime = event.target.checked;
                            })
                          }
                        />{" "}
                        {t("contractSimulator.scenario.overtime", {
                          defaultValue: "overtime",
                        })}
                      </label>
                    )}
                    {line.contract_line_type === "Fixed" && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px]">
                        {t("contractSimulator.scenario.recurringLinePrice", {
                          defaultValue: "Recurring line price",
                        })}
                        <InlineRateEditor
                          id={`edit-rate-${line.key}`}
                          label={t(
                            "contractSimulator.scenario.recurringLinePrice",
                            { defaultValue: "Recurring line price" },
                          )}
                          cents={line.custom_rate}
                          emptyLabel={t(
                            "contractSimulator.scenario.fromServiceRates",
                            { defaultValue: "From service rates" },
                          )}
                          currencyCode={currencyCode}
                          onCommit={(cents) =>
                            onRateChange(line.key, null, null, cents)
                          }
                        />
                      </span>
                    )}
                  </div>
                  {line.enable_overtime && (
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      <label className={fieldLabelClass}>
                        {t(
                          "contractSimulator.scenario.fields.overtimeThreshold",
                          { defaultValue: "Overtime threshold (hours)" },
                        )}
                        <input
                          aria-label={t(
                            "contractSimulator.scenario.fields.overtimeThreshold",
                            { defaultValue: "Overtime threshold hours" },
                          )}
                          type="number"
                          className={fieldClass}
                          placeholder={t(
                            "contractSimulator.scenario.placeholders.thresholdHours",
                            { defaultValue: "threshold hours" },
                          )}
                          value={line.overtime_threshold ?? ""}
                          onChange={(event) =>
                            updateLine(line.key, (draft) => {
                              draft.overtime_threshold =
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value);
                            })
                          }
                        />
                      </label>
                      <label className={fieldLabelClass}>
                        {t("contractSimulator.scenario.fields.overtimeRate", {
                          defaultValue: "Overtime rate ($/hr)",
                        })}
                        <input
                          aria-label={t(
                            "contractSimulator.scenario.fields.overtimeRate",
                            { defaultValue: "Overtime rate dollars" },
                          )}
                          type="number"
                          className={fieldClass}
                          placeholder={t(
                            "contractSimulator.scenario.placeholders.overtimeRate",
                            { defaultValue: "overtime $/hr" },
                          )}
                          value={
                            line.overtime_rate == null
                              ? ""
                              : line.overtime_rate / 100
                          }
                          onChange={(event) =>
                            updateLine(line.key, (draft) => {
                              draft.overtime_rate =
                                event.target.value === ""
                                  ? null
                                  : Math.round(
                                      Number(event.target.value) * 100,
                                    );
                            })
                          }
                        />
                      </label>
                    </div>
                  )}

                  {line.services.map((service, serviceIndex) => {
                    const config = service.configuration;
                    const updateService = (
                      update: (draft: ScenarioLineService) => void,
                    ) =>
                      updateLine(line.key, (draft) =>
                        update(draft.services[serviceIndex]),
                      );
                    const rateLabel =
                      service.item_kind === "product"
                        ? t("contractSimulator.scenario.productUnitPrice", {
                            defaultValue: "Unit price",
                          })
                        : config.configuration_type === "Hourly"
                          ? t("contractSimulator.scenario.hourlyRate", {
                              defaultValue: "Hourly rate",
                            })
                          : config.configuration_type === "Usage"
                            ? t("contractSimulator.scenario.usageRate", {
                                defaultValue: "Usage rate",
                              })
                            : config.configuration_type === "Bucket"
                              ? t("contractSimulator.scenario.overageRate", {
                                  defaultValue: "Overage rate",
                                })
                              : t(
                                  "contractSimulator.scenario.serviceBaseRate",
                                  { defaultValue: "Service base rate" },
                                );
                    const fixedServiceRateIsOverridden =
                      service.item_kind !== "product" &&
                      config.configuration_type === "Fixed" &&
                      line.contract_line_type === "Fixed" &&
                      line.custom_rate !== null;
                    const editor =
                      fixedServiceRateIsOverridden ? null : service.item_kind ===
                        "product" ? (
                        <InlineRateEditor
                          id={`edit-rate-${line.key}-${service.service_id}`}
                          label={rateLabel}
                          cents={service.custom_rate ?? service.default_rate}
                          currencyCode={currencyCode}
                          onCommit={(cents) =>
                            updateService((draft) => {
                              draft.custom_rate = cents;
                              draft.configuration_custom_rate = cents;
                            })
                          }
                        />
                      ) : (
                        serviceRateEditor(
                          line,
                          service,
                          currencyCode,
                          onRateChange,
                          rateLabel,
                        )
                      );
                    return (
                      <div
                        key={`${service.configuration_id ?? service.service_id}:${config.configuration_type}:${serviceIndex}`}
                        className="mt-2 border-t border-[rgb(var(--color-border-200))] pt-2"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[rgb(var(--color-text-700))]">
                            {service.service_name}
                          </span>
                          <TypeBadge type={config.configuration_type} />
                          <span className="text-[10px] text-[rgb(var(--color-text-400))]">
                            {fixedServiceRateIsOverridden
                              ? t(
                                  "contractSimulator.scenario.rateOverriddenByLine",
                                  {
                                    defaultValue:
                                      "Rate replaced by recurring line price",
                                  },
                                )
                              : rateLabel}
                          </span>
                          {editor}
                          <button
                            type="button"
                            className="text-[10px] text-red-600"
                            onClick={() =>
                              updateLine(line.key, (draft) => {
                                draft.services.splice(serviceIndex, 1);
                              })
                            }
                          >
                            {t("contractSimulator.scenario.removeService", {
                              defaultValue: "remove",
                            })}
                          </button>
                        </div>
                        <div
                          className={cn(
                            "mt-1.5 grid gap-1.5",
                            service.item_kind === "product"
                              ? "grid-cols-2"
                              : "grid-cols-1",
                          )}
                        >
                          <label className={fieldLabelClass}>
                            {t(
                              "contractSimulator.scenario.fields.configurationType",
                              { defaultValue: "Service billing method" },
                            )}
                            <select
                              aria-label={t(
                                "contractSimulator.scenario.fields.configurationType",
                                { defaultValue: "Configuration type" },
                              )}
                              disabled={service.item_kind === "product"}
                              className={fieldClass}
                              value={config.configuration_type}
                              onChange={(event) =>
                                updateService((draft) => {
                                  draft.configuration = defaultConfiguration(
                                    event.target
                                      .value as ScenarioServiceConfig["configuration_type"],
                                  );
                                })
                              }
                            >
                              <option value="Fixed">
                                {t("contractSimulator.scenario.types.fixed", {
                                  defaultValue: "Fixed",
                                })}
                              </option>
                              <option value="Hourly">
                                {t("contractSimulator.scenario.types.hourly", {
                                  defaultValue: "Hourly",
                                })}
                              </option>
                              <option value="Usage">
                                {t("contractSimulator.scenario.types.usage", {
                                  defaultValue: "Usage",
                                })}
                              </option>
                              <option value="Bucket">
                                {t("contractSimulator.scenario.types.bucket", {
                                  defaultValue: "Bucket overlay",
                                })}
                              </option>
                            </select>
                          </label>
                          {service.item_kind === "product" && (
                            <label className="flex flex-col gap-1 text-[11px] text-[rgb(var(--color-text-500))]">
                              {t(
                                "contractSimulator.scenario.fields.serviceQuantity",
                                { defaultValue: "License or product quantity" },
                              )}
                              <input
                                aria-label={t(
                                  "contractSimulator.scenario.fields.serviceQuantity",
                                  {
                                    defaultValue: "License or product quantity",
                                  },
                                )}
                                type="number"
                                min="1"
                                className={fieldClass}
                                value={service.quantity}
                                onChange={(event) =>
                                  updateService((draft) => {
                                    draft.quantity = Math.max(
                                      1,
                                      Number(event.target.value) || 1,
                                    );
                                    draft.configuration_quantity =
                                      draft.quantity;
                                  })
                                }
                              />
                            </label>
                          )}
                        </div>
                        {config.configuration_type === "Hourly" && (
                          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                            <label className={fieldLabelClass}>
                              {t(
                                "contractSimulator.scenario.fields.minimumBillableMinutes",
                                { defaultValue: "Minimum billable minutes" },
                              )}
                              <input
                                aria-label={t(
                                  "contractSimulator.scenario.fields.minimumBillableMinutes",
                                  { defaultValue: "Minimum billable minutes" },
                                )}
                                type="number"
                                className={fieldClass}
                                placeholder={t(
                                  "contractSimulator.scenario.placeholders.minimumMinutes",
                                  { defaultValue: "minimum minutes" },
                                )}
                                value={config.minimum_billable_time}
                                onChange={(event) =>
                                  updateService((draft) => {
                                    if (
                                      draft.configuration.configuration_type ===
                                      "Hourly"
                                    )
                                      draft.configuration.minimum_billable_time =
                                        Number(event.target.value) || 0;
                                  })
                                }
                              />
                            </label>
                            <label className={fieldLabelClass}>
                              {t(
                                "contractSimulator.scenario.fields.roundUpMinutes",
                                { defaultValue: "Round up to minutes" },
                              )}
                              <input
                                aria-label={t(
                                  "contractSimulator.scenario.fields.roundUpMinutes",
                                  { defaultValue: "Round up minutes" },
                                )}
                                type="number"
                                className={fieldClass}
                                placeholder={t(
                                  "contractSimulator.scenario.placeholders.roundMinutes",
                                  { defaultValue: "round minutes" },
                                )}
                                value={config.round_up_to_nearest}
                                onChange={(event) =>
                                  updateService((draft) => {
                                    if (
                                      draft.configuration.configuration_type ===
                                      "Hourly"
                                    )
                                      draft.configuration.round_up_to_nearest =
                                        Number(event.target.value) || 0;
                                  })
                                }
                              />
                            </label>
                          </div>
                        )}
                        {config.configuration_type === "Usage" && (
                          <div className="mt-1.5 space-y-1.5">
                            <div className="grid grid-cols-2 gap-1.5">
                              <label className={fieldLabelClass}>
                                {t(
                                  "contractSimulator.scenario.fields.usageUnit",
                                  { defaultValue: "Usage unit" },
                                )}
                                <input
                                  aria-label={t(
                                    "contractSimulator.scenario.fields.usageUnit",
                                    { defaultValue: "Usage unit" },
                                  )}
                                  className={fieldClass}
                                  value={config.unit_of_measure}
                                  onChange={(event) =>
                                    updateService((draft) => {
                                      if (
                                        draft.configuration
                                          .configuration_type === "Usage"
                                      )
                                        draft.configuration.unit_of_measure =
                                          event.target.value;
                                    })
                                  }
                                />
                              </label>
                              <label className={fieldLabelClass}>
                                {t(
                                  "contractSimulator.scenario.fields.minimumUsage",
                                  { defaultValue: "Minimum usage" },
                                )}
                                <input
                                  aria-label={t(
                                    "contractSimulator.scenario.fields.minimumUsage",
                                    { defaultValue: "Minimum usage" },
                                  )}
                                  type="number"
                                  className={fieldClass}
                                  placeholder={t(
                                    "contractSimulator.scenario.placeholders.minimum",
                                    { defaultValue: "minimum" },
                                  )}
                                  value={config.minimum_usage ?? ""}
                                  onChange={(event) =>
                                    updateService((draft) => {
                                      if (
                                        draft.configuration
                                          .configuration_type === "Usage"
                                      )
                                        draft.configuration.minimum_usage =
                                          event.target.value === ""
                                            ? null
                                            : Number(event.target.value);
                                    })
                                  }
                                />
                              </label>
                            </div>
                            <label className="text-[10px] text-[rgb(var(--color-text-600))]">
                              <input
                                type="checkbox"
                                checked={config.enable_tiered_pricing}
                                onChange={(event) =>
                                  updateService((draft) => {
                                    if (
                                      draft.configuration.configuration_type ===
                                      "Usage"
                                    )
                                      draft.configuration.enable_tiered_pricing =
                                        event.target.checked;
                                  })
                                }
                              />{" "}
                              {t("contractSimulator.scenario.tieredPricing", {
                                defaultValue: "tiered pricing",
                              })}
                            </label>
                            {config.tiers.map((tier, tierIndex) => (
                              <div key={tierIndex}>
                                <div className="mb-0.5 grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-[9px] text-[rgb(var(--color-text-400))]">
                                  <span>Minimum</span>
                                  <span>Maximum</span>
                                  <span>Rate ($)</span>
                                  <span className="w-3" />
                                </div>
                                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1">
                                  <input
                                    aria-label={t(
                                      "contractSimulator.scenario.fields.tierMinimum",
                                      { defaultValue: "Tier minimum" },
                                    )}
                                    type="number"
                                    className={fieldClass}
                                    value={tier.min_quantity}
                                    onChange={(event) =>
                                      updateService((draft) => {
                                        if (
                                          draft.configuration
                                            .configuration_type === "Usage"
                                        )
                                          draft.configuration.tiers[
                                            tierIndex
                                          ].min_quantity = Number(
                                            event.target.value,
                                          );
                                      })
                                    }
                                  />
                                  <input
                                    aria-label={t(
                                      "contractSimulator.scenario.fields.tierMaximum",
                                      { defaultValue: "Tier maximum" },
                                    )}
                                    type="number"
                                    className={fieldClass}
                                    value={tier.max_quantity ?? ""}
                                    onChange={(event) =>
                                      updateService((draft) => {
                                        if (
                                          draft.configuration
                                            .configuration_type === "Usage"
                                        )
                                          draft.configuration.tiers[
                                            tierIndex
                                          ].max_quantity =
                                            event.target.value === ""
                                              ? null
                                              : Number(event.target.value);
                                      })
                                    }
                                  />
                                  <input
                                    aria-label={t(
                                      "contractSimulator.scenario.fields.tierRate",
                                      { defaultValue: "Tier rate dollars" },
                                    )}
                                    type="number"
                                    className={fieldClass}
                                    value={tier.rate / 100}
                                    onChange={(event) =>
                                      updateService((draft) => {
                                        if (
                                          draft.configuration
                                            .configuration_type === "Usage"
                                        )
                                          draft.configuration.tiers[
                                            tierIndex
                                          ].rate = Math.round(
                                            Number(event.target.value) * 100,
                                          );
                                      })
                                    }
                                  />
                                  <button
                                    type="button"
                                    aria-label={t(
                                      "contractSimulator.scenario.removeTier",
                                      { defaultValue: "Remove tier" },
                                    )}
                                    onClick={() =>
                                      updateService((draft) => {
                                        if (
                                          draft.configuration
                                            .configuration_type === "Usage"
                                        )
                                          draft.configuration.tiers.splice(
                                            tierIndex,
                                            1,
                                          );
                                      })
                                    }
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="text-[10px] text-[rgb(var(--color-primary-600))]"
                              onClick={() =>
                                updateService((draft) => {
                                  if (
                                    draft.configuration.configuration_type ===
                                    "Usage"
                                  )
                                    draft.configuration.tiers.push({
                                      min_quantity: 1,
                                      max_quantity: null,
                                      rate: 0,
                                    });
                                })
                              }
                            >
                              {t("contractSimulator.scenario.addTier", {
                                defaultValue: "+ add tier",
                              })}
                            </button>
                          </div>
                        )}
                        {config.configuration_type === "Bucket" && (
                          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                            <label className={fieldLabelClass}>
                              {t(
                                line.contract_line_type === "Usage"
                                  ? "contractSimulator.scenario.fields.includedUnits"
                                  : "contractSimulator.scenario.fields.includedHours",
                                {
                                  defaultValue:
                                    line.contract_line_type === "Usage"
                                      ? "Included units"
                                      : "Included hours",
                                },
                              )}
                              <input
                                aria-label={t(
                                  "contractSimulator.scenario.fields.bucketQuantity",
                                  { defaultValue: "Included bucket quantity" },
                                )}
                                type="number"
                                className={fieldClass}
                                value={
                                  line.contract_line_type === "Usage"
                                    ? config.total_minutes
                                    : config.total_minutes / 60
                                }
                                onChange={(event) =>
                                  updateService((draft) => {
                                    if (
                                      draft.configuration.configuration_type ===
                                      "Bucket"
                                    )
                                      draft.configuration.total_minutes =
                                        Number(event.target.value) *
                                        (line.contract_line_type === "Usage"
                                          ? 1
                                          : 60);
                                  })
                                }
                              />
                            </label>
                            <label className="text-[10px] text-[rgb(var(--color-text-600))]">
                              <input
                                type="checkbox"
                                checked={config.allow_rollover}
                                onChange={(event) =>
                                  updateService((draft) => {
                                    if (
                                      draft.configuration.configuration_type ===
                                      "Bucket"
                                    )
                                      draft.configuration.allow_rollover =
                                        event.target.checked;
                                  })
                                }
                              />{" "}
                              {t("contractSimulator.scenario.rollover", {
                                defaultValue: "rollover",
                              })}
                            </label>
                          </div>
                        )}
                        {service.item_kind !== "product" &&
                          config.configuration_type !== "Bucket" &&
                          !line.services.some(
                            (candidate) =>
                              candidate.service_id === service.service_id &&
                              candidate.configuration.configuration_type ===
                                "Bucket",
                          ) && (
                            <button
                              type="button"
                              className="mt-1 text-[10px] text-[rgb(var(--color-primary-600))]"
                              onClick={() =>
                                updateLine(line.key, (draft) => {
                                  draft.services.push({
                                    ...structuredClone(service),
                                    configuration_id: `scenario-bucket-${Date.now()}`,
                                    configuration:
                                      defaultConfiguration("Bucket"),
                                  });
                                })
                              }
                            >
                              {line.contract_line_type === "Usage"
                                ? t(
                                    "contractSimulator.scenario.addIncludedUnits",
                                    { defaultValue: "Add included units" },
                                  )
                                : t(
                                    "contractSimulator.scenario.addIncludedHours",
                                    { defaultValue: "Add included hours" },
                                  )}
                            </button>
                          )}
                      </div>
                    );
                  })}

                  <select
                    id={`add-service-${line.key}`}
                    aria-label={t(
                      "contractSimulator.scenario.addCatalogService",
                      { defaultValue: "Add catalog service" },
                    )}
                    className={`${fieldClass} mt-2 w-full`}
                    value=""
                    onChange={(event) => {
                      addService(line.key, event.target.value);
                      event.currentTarget.value = "";
                    }}
                  >
                    <option value="">
                      {t("contractSimulator.scenario.addCatalogServiceOption", {
                        defaultValue: "+ Add catalog service…",
                      })}
                    </option>
                    {availableServices.map((service) => (
                      <option
                        key={service.service_id}
                        value={service.service_id}
                      >
                        {service.service_name}
                        {service.is_license
                          ? t("contractSimulator.scenario.licenseSuffix", {
                              defaultValue: " · license",
                            })
                          : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          );
        })}
      </div>

      <details className="border-t border-[rgb(var(--color-border-200))]">
        <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-[rgb(var(--color-text-700))]">
          {t("contractSimulator.scenario.advancedChanges", {
            defaultValue: "Advanced contract changes",
          })}
          <span className="ml-2 font-normal text-[rgb(var(--color-text-400))]">
            {t("contractSimulator.scenario.advancedSummary", {
              defaultValue:
                "{{schedules}} schedules · {{discounts}} discounts · {{adjustments}} adjustments",
              schedules: pricingSchedules.length,
              discounts: discounts.length,
              adjustments: adjustments.length,
            })}
          </span>
        </summary>
        <div>
          <div className="border-t border-[rgb(var(--color-border-200))] p-3">
            <div className="flex items-center justify-between text-xs font-semibold text-[rgb(var(--color-text-700))]">
              {t("contractSimulator.scenario.pricingSchedules", {
                defaultValue: "Pricing schedules",
              })}
              <button
                type="button"
                className="text-[10px] text-[rgb(var(--color-primary-600))]"
                onClick={() =>
                  onPricingSchedulesChange([
                    ...pricingSchedules,
                    {
                      effective_date: `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
                      end_date: null,
                      custom_rate: null,
                    },
                  ])
                }
              >
                {t("contractSimulator.scenario.addSchedule", {
                  defaultValue: "+ add schedule",
                })}
              </button>
            </div>
            {pricingSchedules.length > 0 && (
              <div className="mt-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-[9px] text-[rgb(var(--color-text-400))]">
                <span>Starts</span>
                <span>Ends</span>
                <span>Rate ($)</span>
                <span className="w-3" />
              </div>
            )}
            {pricingSchedules.map((schedule, index) => (
              <div
                key={index}
                className="mt-1 grid grid-cols-[1fr_1fr_1fr_auto] gap-1"
              >
                <DatePicker
                  label={t(
                    "contractSimulator.scenario.fields.scheduleEffectiveDate",
                    { defaultValue: "Schedule effective date" },
                  )}
                  className="min-w-0"
                  value={dateFromString(schedule.effective_date.slice(0, 10))}
                  onChange={(date) =>
                    onPricingSchedulesChange(
                      pricingSchedules.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              effective_date: `${dateToString(date)}T00:00:00Z`,
                            }
                          : candidate,
                      ),
                    )
                  }
                />
                <DatePicker
                  label={t(
                    "contractSimulator.scenario.fields.scheduleEndDate",
                    { defaultValue: "Schedule end date" },
                  )}
                  clearable
                  className="min-w-0"
                  value={dateFromString(schedule.end_date?.slice(0, 10))}
                  onChange={(date) =>
                    onPricingSchedulesChange(
                      pricingSchedules.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              end_date: date
                                ? `${dateToString(date)}T00:00:00Z`
                                : null,
                            }
                          : candidate,
                      ),
                    )
                  }
                />
                <input
                  aria-label={t(
                    "contractSimulator.scenario.fields.scheduleRate",
                    {
                      defaultValue: "Schedule rate dollars",
                    },
                  )}
                  type="number"
                  className={fieldClass}
                  value={
                    schedule.custom_rate == null
                      ? ""
                      : schedule.custom_rate / 100
                  }
                  onChange={(event) =>
                    onPricingSchedulesChange(
                      pricingSchedules.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              custom_rate:
                                event.target.value === ""
                                  ? null
                                  : Math.round(
                                      Number(event.target.value) * 100,
                                    ),
                            }
                          : candidate,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={t("contractSimulator.scenario.removeSchedule", {
                    defaultValue: "Remove pricing schedule",
                  })}
                  onClick={() =>
                    onPricingSchedulesChange(
                      pricingSchedules.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-[rgb(var(--color-border-200))] p-3">
            <div className="flex items-center justify-between text-xs font-semibold text-[rgb(var(--color-text-700))]">
              {t("contractSimulator.scenario.discounts", {
                defaultValue: "Discounts",
              })}
              <button
                type="button"
                className="text-[10px] text-[rgb(var(--color-primary-600))]"
                onClick={() =>
                  onDiscountsChange([
                    ...discounts,
                    {
                      discount_id: `scenario-discount-${Date.now()}`,
                      discount_name: t(
                        "contractSimulator.scenario.newDiscountName",
                        {
                          defaultValue: "Scenario discount",
                        },
                      ),
                      discount_type: "percentage",
                      value: 0.1,
                      start_date: `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
                      end_date: null,
                      contract_line_keys: lines.map((line) => line.key),
                    },
                  ])
                }
              >
                {t("contractSimulator.scenario.addDiscount", {
                  defaultValue: "+ add discount",
                })}
              </button>
            </div>
            {discounts.length > 0 && (
              <div className="mt-2 grid grid-cols-[1.4fr_0.8fr_0.8fr_1fr_auto] gap-1 text-[9px] text-[rgb(var(--color-text-400))]">
                <span>{t("contractSimulator.scenario.columns.name", { defaultValue: "Name" })}</span>
                <span>{t("contractSimulator.scenario.columns.type", { defaultValue: "Type" })}</span>
                <span>{t("contractSimulator.scenario.columns.value", { defaultValue: "Value" })}</span>
                <span>{t("contractSimulator.scenario.columns.appliesTo", { defaultValue: "Applies to" })}</span>
                <span className="w-3" />
              </div>
            )}
            {discounts.map((discount, index) => (
              <div
                key={discount.discount_id}
                className="mt-1 grid grid-cols-[1.4fr_0.8fr_0.8fr_1fr_auto] gap-1"
              >
                <input
                  aria-label={t(
                    "contractSimulator.scenario.fields.discountName",
                    {
                      defaultValue: "Discount name",
                    },
                  )}
                  className={fieldClass}
                  value={discount.discount_name}
                  onChange={(event) =>
                    onDiscountsChange(
                      discounts.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, discount_name: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
                <select
                  aria-label={t(
                    "contractSimulator.scenario.fields.discountType",
                    {
                      defaultValue: "Discount type",
                    },
                  )}
                  className={fieldClass}
                  value={discount.discount_type}
                  onChange={(event) =>
                    onDiscountsChange(
                      discounts.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              discount_type: event.target
                                .value as ScenarioDiscount["discount_type"],
                            }
                          : candidate,
                      ),
                    )
                  }
                >
                  <option value="percentage">
                    {t("contractSimulator.scenario.discountTypes.percentage", {
                      defaultValue: "percent",
                    })}
                  </option>
                  <option value="fixed">
                    {t("contractSimulator.scenario.discountTypes.fixed", {
                      defaultValue: "fixed",
                    })}
                  </option>
                </select>
                <input
                  aria-label={t(
                    "contractSimulator.scenario.fields.discountValue",
                    {
                      defaultValue: "Discount value",
                    },
                  )}
                  type="number"
                  className={fieldClass}
                  value={
                    discount.discount_type === "percentage"
                      ? discount.value * 100
                      : discount.value / 100
                  }
                  onChange={(event) =>
                    onDiscountsChange(
                      discounts.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              value:
                                discount.discount_type === "percentage"
                                  ? Number(event.target.value) / 100
                                  : Math.round(
                                      Number(event.target.value) * 100,
                                    ),
                            }
                          : candidate,
                      ),
                    )
                  }
                />
                <select
                  aria-label={t(
                    "contractSimulator.scenario.fields.discountLine",
                    {
                      defaultValue: "Discount line",
                    },
                  )}
                  className={fieldClass}
                  value={
                    discount.contract_line_keys.length === 1
                      ? discount.contract_line_keys[0]
                      : ""
                  }
                  onChange={(event) =>
                    onDiscountsChange(
                      discounts.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              contract_line_keys: event.target.value
                                ? [event.target.value]
                                : lines.map((line) => line.key),
                            }
                          : candidate,
                      ),
                    )
                  }
                >
                  <option value="">
                    {t("contractSimulator.scenario.allLines", {
                      defaultValue: "all lines",
                    })}
                  </option>
                  {lines.map((line) => (
                    <option key={line.key} value={line.key}>
                      {line.contract_line_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={t("contractSimulator.scenario.removeDiscount", {
                    defaultValue: "Remove discount",
                  })}
                  onClick={() =>
                    onDiscountsChange(
                      discounts.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-[rgb(var(--color-border-200))] p-3">
            <div className="flex items-center justify-between text-xs font-semibold text-[rgb(var(--color-text-700))]">
              {t("contractSimulator.scenario.adjustments", {
                defaultValue: "Adjustments",
              })}
              <button
                type="button"
                className="text-[10px] text-[rgb(var(--color-primary-600))]"
                onClick={() =>
                  onAdjustmentsChange([
                    ...adjustments,
                    {
                      description: t(
                        "contractSimulator.scenario.newAdjustmentName",
                        {
                          defaultValue: "One-time adjustment",
                        },
                      ),
                      amount: 0,
                      one_time: true,
                      period_index: 0,
                    },
                  ])
                }
              >
                {t("contractSimulator.scenario.addAdjustment", {
                  defaultValue: "+ add adjustment",
                })}
              </button>
            </div>
            {adjustments.length > 0 && (
              <div className="mt-2 grid grid-cols-[1.4fr_0.8fr_0.8fr_auto_auto] gap-1 text-[9px] text-[rgb(var(--color-text-400))]">
                <span>{t("contractSimulator.scenario.columns.description", { defaultValue: "Description" })}</span>
                <span>{t("contractSimulator.scenario.columns.amount", { defaultValue: "Amount ($)" })}</span>
                <span>{t("contractSimulator.scenario.columns.billingPeriod", { defaultValue: "Billing period" })}</span>
                <span>{t("contractSimulator.scenario.columns.timing", { defaultValue: "Timing" })}</span>
                <span className="w-3" />
              </div>
            )}
            {adjustments.map((adjustment, index) => (
              <div
                key={index}
                className="mt-1 grid grid-cols-[1.4fr_0.8fr_0.8fr_auto_auto] items-center gap-1"
              >
                <input
                  aria-label={t(
                    "contractSimulator.scenario.fields.adjustmentDescription",
                    { defaultValue: "Adjustment description" },
                  )}
                  className={fieldClass}
                  value={adjustment.description}
                  onChange={(event) =>
                    onAdjustmentsChange(
                      adjustments.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, description: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
                <input
                  aria-label={t(
                    "contractSimulator.scenario.fields.adjustmentAmount",
                    { defaultValue: "Adjustment amount dollars" },
                  )}
                  type="number"
                  className={fieldClass}
                  value={adjustment.amount / 100}
                  onChange={(event) =>
                    onAdjustmentsChange(
                      adjustments.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              amount: Math.round(
                                Number(event.target.value) * 100,
                              ),
                            }
                          : candidate,
                      ),
                    )
                  }
                />
                <input
                  aria-label={t(
                    "contractSimulator.scenario.fields.adjustmentPeriod",
                    { defaultValue: "Adjustment period" },
                  )}
                  type="number"
                  min="1"
                  className={fieldClass}
                  disabled={!adjustment.one_time}
                  value={(adjustment.period_index ?? 0) + 1}
                  onChange={(event) =>
                    onAdjustmentsChange(
                      adjustments.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              period_index: Math.max(
                                0,
                                Number(event.target.value) - 1,
                              ),
                            }
                          : candidate,
                      ),
                    )
                  }
                />
                <label className="text-[10px]">
                  <input
                    type="checkbox"
                    checked={Boolean(adjustment.one_time)}
                    onChange={(event) =>
                      onAdjustmentsChange(
                        adjustments.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? {
                                ...candidate,
                                one_time: event.target.checked,
                                period_index: event.target.checked
                                  ? (candidate.period_index ?? 0)
                                  : null,
                              }
                            : candidate,
                        ),
                      )
                    }
                  />{" "}
                  {t("contractSimulator.scenario.oneTime", {
                    defaultValue: "one-time",
                  })}
                </label>
                <button
                  type="button"
                  aria-label={t("contractSimulator.scenario.removeAdjustment", {
                    defaultValue: "Remove adjustment",
                  })}
                  onClick={() =>
                    onAdjustmentsChange(
                      adjustments.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
};

export default ScenarioPanel;
