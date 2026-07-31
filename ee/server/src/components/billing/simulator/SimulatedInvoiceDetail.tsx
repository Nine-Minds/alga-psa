"use client";

import React from "react";
import { cn } from "@alga-psa/ui/lib/utils";
import { useFormatters, useTranslation } from "@alga-psa/ui/lib/i18n/client";
import type {
  SimulatedInvoiceLine,
  SimulatedPeriod,
  SimulationLineDelta,
  IInvoiceTemplate,
  ScenarioReplayInvoice,
} from "@alga-psa/types";
import { TemplateRenderer } from "@alga-psa/billing/components/billing-dashboard/TemplateRenderer";

interface SimulatedInvoiceDetailProps {
  period: SimulatedPeriod;
  currencyCode: string;
  selectedChargeKey: string | null;
  lineDeltas: SimulationLineDelta[];
  template: IInvoiceTemplate | null;
  actualInvoice: ScenarioReplayInvoice | null;
  onExplainLine: (line: SimulatedInvoiceLine) => void;
}

function humanizeChargeType(chargeType: string): string {
  const labels: Record<string, string> = {
    fixed: "Fixed charge",
    time: "Hourly charge",
    hourly: "Hourly charge",
    usage: "Usage charge",
    bucket_overage: "Overage charge",
    product: "Product charge",
    license: "License charge",
    discount: "Discount",
    adjustment: "Adjustment",
  };
  return (
    labels[chargeType] ??
    `${chargeType.charAt(0).toUpperCase()}${chargeType.slice(1).replaceAll("_", " ")}`
  );
}

const SimulatedInvoiceDetail: React.FC<SimulatedInvoiceDetailProps> = ({
  period,
  currencyCode,
  selectedChargeKey,
  lineDeltas,
  template,
  actualInvoice,
  onExplainLine,
}) => {
  const { t } = useTranslation("msp/contracts");
  const { formatCurrency, formatDate } = useFormatters();

  const money = (cents: number) => formatCurrency(cents / 100, currencyCode);
  const dateOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--color-border-200))] px-4 py-3">
        <div>
          <h4 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
            {t("contractSimulator.invoiceDetail.title", {
              defaultValue: "{{period}} invoice projection",
              period: period.label,
            })}
          </h4>
          <div className="text-[11px] text-[rgb(var(--color-text-500))]">
            {t("contractSimulator.invoiceDetail.invoicePeriod", {
              defaultValue: "Invoice period: {{start}} – {{end}}",
              start: formatDate(period.period_start, dateOptions),
              end: formatDate(period.period_end, dateOptions),
            })}
          </div>
        </div>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
              {t("contractSimulator.invoiceDetail.columns.line", {
                defaultValue: "Line",
              })}
            </th>
            <th className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
              {t("contractSimulator.invoiceDetail.columns.qty", {
                defaultValue: "Quantity",
              })}
            </th>
            <th className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
              {t("contractSimulator.invoiceDetail.columns.rate", {
                defaultValue: "Rate",
              })}
            </th>
            <th className="border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-400))]">
              {t("contractSimulator.invoiceDetail.columns.amount", {
                defaultValue: "Amount",
              })}
            </th>
          </tr>
        </thead>
        <tbody>
          {period.lines.map((line, index) => {
            const selected =
              selectedChargeKey !== null &&
              line.explanation?.chargeKey === selectedChargeKey;
            const lineDelta = lineDeltas.find(
              (delta) =>
                delta.line_key === line.line_key &&
                delta.service_id === line.service_id &&
                delta.charge_type === line.charge_type,
            );
            return (
              <tr key={`${line.line_key}-${line.service_id ?? index}`}>
                <td className="border-b border-[rgb(var(--color-border-200))] px-4 py-2.5 text-xs font-medium text-[rgb(var(--color-text-800))]">
                  {line.service_name}
                  <div className="text-[10px] font-normal text-[rgb(var(--color-text-400))]">
                    {humanizeChargeType(line.charge_type)}
                    {line.billing_timing && (
                      <>
                        {" · "}
                        {line.billing_timing === "arrears"
                          ? t(
                              "contractSimulator.invoiceDetail.billedInArrears",
                              { defaultValue: "Billed in arrears" },
                            )
                          : t(
                              "contractSimulator.invoiceDetail.billedInAdvance",
                              { defaultValue: "Billed in advance" },
                            )}
                      </>
                    )}
                    {line.service_period_start && line.service_period_end && (
                      <>
                        {" · "}
                        {t("contractSimulator.invoiceDetail.servicePeriod", {
                          defaultValue: "Service period: {{start}} – {{end}}",
                          start: formatDate(
                            line.service_period_start,
                            dateOptions,
                          ),
                          end: formatDate(line.service_period_end, dateOptions),
                        })}
                      </>
                    )}
                    {lineDelta && (
                      <span className="ml-1 text-[rgb(var(--color-primary-600))]">
                        ·{" "}
                        {lineDelta.kind === "added"
                          ? t("contractSimulator.compare.added", {
                              defaultValue: "Added",
                            })
                          : t("contractSimulator.compare.changed", {
                              defaultValue: "Changed",
                            })}{" "}
                        · {lineDelta.delta >= 0 ? "+" : "−"}
                        {money(Math.abs(lineDelta.delta))}
                      </span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap border-b border-[rgb(var(--color-border-200))] px-4 py-2.5 text-right font-mono text-xs text-[rgb(var(--color-text-500))]">
                  {line.quantity_label}
                </td>
                <td className="whitespace-nowrap border-b border-[rgb(var(--color-border-200))] px-4 py-2.5 text-right font-mono text-xs text-[rgb(var(--color-text-500))]">
                  {line.rate_label}
                </td>
                <td className="whitespace-nowrap border-b border-[rgb(var(--color-border-200))] px-2 py-1.5 text-right">
                  <button
                    id={`explain-invoice-line-${period.index}-${index}`}
                    type="button"
                    onClick={() => onExplainLine(line)}
                    title={t("contractSimulator.invoiceDetail.explainHint", {
                      defaultValue: "Show how this amount was computed",
                    })}
                    className={cn(
                      "w-full rounded px-2 py-1 text-right font-mono text-xs text-[rgb(var(--color-text-900))]",
                      selected
                        ? "bg-[rgb(var(--color-primary-50))] ring-1 ring-inset ring-[rgb(var(--color-primary-500))] dark:bg-[rgb(var(--color-primary-400)/0.15)]"
                        : "hover:bg-[rgb(var(--color-primary-50))] hover:ring-1 hover:ring-inset hover:ring-[rgb(var(--color-primary-300))] dark:hover:bg-[rgb(var(--color-primary-400)/0.15)]",
                    )}
                  >
                    {money(line.net_amount)}
                  </button>
                </td>
              </tr>
            );
          })}
          {lineDeltas
            .filter(
              (delta) =>
                delta.kind === "removed" &&
                !period.lines.some(
                  (line) =>
                    line.line_key === delta.line_key &&
                    line.service_id === delta.service_id &&
                    line.charge_type === delta.charge_type,
                ),
            )
            .map((delta) => (
              <tr
                key={`removed:${delta.line_key}:${delta.service_id ?? "none"}:${delta.charge_type}`}
              >
                <td className="border-b border-[rgb(var(--color-border-200))] px-4 py-2.5 text-xs text-[rgb(var(--color-text-500))] line-through">
                  {delta.service_name}
                  <div className="text-[10px] font-normal text-red-600 dark:text-red-400">
                    {t("contractSimulator.compare.removed", {
                      defaultValue: "removed vs live",
                    })}
                  </div>
                </td>
                <td
                  colSpan={2}
                  className="border-b border-[rgb(var(--color-border-200))] px-4 py-2.5"
                />
                <td className="border-b border-[rgb(var(--color-border-200))] px-4 py-2.5 text-right font-mono text-xs text-red-600 dark:text-red-400">
                  −{money(Math.abs(delta.delta))}
                </td>
              </tr>
            ))}
          <tr>
            <td
              colSpan={3}
              className="px-4 pb-1 pt-3 text-right text-xs text-[rgb(var(--color-text-600))]"
            >
              {t("contractSimulator.invoiceDetail.subtotal", {
                defaultValue: "Subtotal",
              })}
            </td>
            <td className="whitespace-nowrap px-4 pb-1 pt-3 text-right font-mono text-xs font-medium text-[rgb(var(--color-text-900))]">
              {money(period.subtotal)}
            </td>
          </tr>
          <tr>
            <td
              colSpan={3}
              className="px-4 py-1 text-right text-xs text-[rgb(var(--color-text-600))]"
            >
              {t("contractSimulator.invoiceDetail.tax", {
                defaultValue: "Tax",
              })}
            </td>
            <td className="whitespace-nowrap px-4 py-1 text-right font-mono text-xs font-medium text-[rgb(var(--color-text-900))]">
              {money(period.tax)}
            </td>
          </tr>
          <tr>
            <td
              colSpan={3}
              className="border-t border-[rgb(var(--color-border-200))] px-4 py-3 text-right text-sm font-semibold text-[rgb(var(--color-text-900))]"
            >
              {t("contractSimulator.invoiceDetail.total", {
                defaultValue: "Total",
              })}
            </td>
            <td className="whitespace-nowrap border-t border-[rgb(var(--color-border-200))] px-4 py-3 text-right font-mono text-base font-semibold text-[rgb(var(--color-text-900))]">
              {money(period.total)}
            </td>
          </tr>
        </tbody>
      </table>
      {template && (
        <details className="border-t border-[rgb(var(--color-border-200))]">
          <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-[rgb(var(--color-text-600))]">
            {t("contractSimulator.invoiceDetail.renderedPreview", {
              defaultValue: "Preview invoice layout",
            })}
          </summary>
          <div className="px-4 pb-4">
            <TemplateRenderer
              template={template}
              invoiceData={period.invoice_view_model}
            />
          </div>
        </details>
      )}
      {actualInvoice && (
        <div className="border-t border-[rgb(var(--color-border-200))] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-[rgb(var(--color-text-800))]">
                {t("contractSimulator.replay.actualInvoice", {
                  defaultValue: "Issued invoice {{number}}",
                  number: actualInvoice.invoice_number,
                })}
              </div>
              <div className="text-[10px] text-[rgb(var(--color-text-400))]">
                {actualInvoice.status}
              </div>
            </div>
            <div className="text-right font-mono text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {money(actualInvoice.total)}
              <div className="text-[10px] font-normal text-[rgb(var(--color-text-500))]">
                {period.total - actualInvoice.total >= 0 ? "+" : "−"}
                {money(Math.abs(period.total - actualInvoice.total))}{" "}
                {t("contractSimulator.replay.simulatedDelta", {
                  defaultValue: "projected difference",
                })}
              </div>
            </div>
          </div>
          <div className="space-y-1 rounded border border-[rgb(var(--color-border-200))] p-2">
            {Array.from(
              new Map(
                [...actualInvoice.lines, ...period.lines].map((line) => [
                  `${line.line_key}:${line.service_id ?? "none"}:${line.charge_type}`,
                  line,
                ]),
              ).entries(),
            ).map(([key, representative]) => {
              const actual = actualInvoice.lines.find(
                (line) =>
                  `${line.line_key}:${line.service_id ?? "none"}:${line.charge_type}` ===
                  key,
              );
              const simulated = period.lines.find(
                (line) =>
                  `${line.line_key}:${line.service_id ?? "none"}:${line.charge_type}` ===
                  key,
              );
              const delta = (simulated?.total ?? 0) - (actual?.total ?? 0);
              return (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 text-[11px]"
                >
                  <span className="truncate text-[rgb(var(--color-text-700))]">
                    {representative.service_name}
                  </span>
                  <span className="font-mono text-[rgb(var(--color-text-500))]">
                    {money(actual?.total ?? 0)}{" "}
                    {t("contractSimulator.replay.issued", {
                      defaultValue: "issued",
                    })}
                  </span>
                  <span className="font-mono text-[rgb(var(--color-text-500))]">
                    {money(simulated?.total ?? 0)}{" "}
                    {t("contractSimulator.replay.projected", {
                      defaultValue: "projected",
                    })}
                  </span>
                  <span className="font-mono text-[rgb(var(--color-primary-600))]">
                    {delta >= 0 ? "+" : "−"}
                    {money(Math.abs(delta))}
                  </span>
                </div>
              );
            })}
          </div>
          {template && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-[rgb(var(--color-text-600))]">
                {t("contractSimulator.replay.previewIssued", {
                  defaultValue: "Preview issued invoice",
                })}
              </summary>
              <div className="mt-2">
                <TemplateRenderer
                  template={template}
                  invoiceData={actualInvoice.invoice_view_model}
                />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

export default SimulatedInvoiceDetail;
