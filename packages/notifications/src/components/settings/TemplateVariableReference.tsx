"use client";

import { useMemo, useState } from "react";
import { Badge } from "@alga-psa/ui/components/Badge";
import { Button } from "@alga-psa/ui/components/Button";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { Dialog, DialogContent } from "@alga-psa/ui/components/Dialog";
import { Input } from "@alga-psa/ui/components/Input";
import { Check, Copy, ExternalLink, Search } from "lucide-react";
import {
  templateVariableCategories,
  templateVariableRegistry,
  type VariableDef,
} from "../../lib/templateVariables";

const DOCUMENTATION_URL =
  "https://algapsa.com/documentation/email-template-variables";

function tokenFor(variable: VariableDef): string {
  return variable.type === "raw-html"
    ? `{{{${variable.path}}}}`
    : `{{${variable.path}}}`;
}

function matchesSearch(variable: VariableDef, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    variable.path,
    variable.description,
    variable.notes,
    ...variable.concept,
  ].some((value) => value?.toLowerCase().includes(query));
}

function VariableRow({
  variable,
  rowId,
  onInsert,
  appliesTo,
}: {
  variable: VariableDef;
  rowId: string;
  onInsert?: (token: string) => void;
  appliesTo?: string[];
}) {
  const [copied, setCopied] = useState(false);
  const token = tokenFor(variable);
  const copy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="group border-b border-[rgb(var(--color-border-200))] py-3 last:border-0">
      <div className="flex items-start gap-2">
        <button
          id={`${rowId}-insert`}
          type="button"
          className={`min-w-0 flex-1 text-left ${onInsert ? "cursor-text" : "cursor-default"}`}
          onClick={() => onInsert?.(token)}
          title={onInsert ? "Insert at cursor" : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all text-xs font-semibold text-primary-700 dark:text-primary-300">
              {variable.path}
            </code>
            <Badge
              size="sm"
              variant={
                variable.type === "raw-html" ? "warning" : "default-muted"
              }
            >
              {variable.type}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[rgb(var(--color-text-600))]">
            {variable.description}
          </p>
          <p className="mt-1 hidden break-words text-xs text-[rgb(var(--color-text-500))] group-hover:block group-focus-within:block">
            Example: <span className="font-mono">{variable.example}</span>
          </p>
          {appliesTo && (
            <p className="mt-1 text-[11px] text-[rgb(var(--color-text-500))]">
              Used by {appliesTo.join(", ")}
            </p>
          )}
        </button>
        <Button
          id={`${rowId}-copy`}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0"
          onClick={copy}
          aria-label={`Copy ${variable.path}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function TemplateVariablePanel({
  templateName,
  onInsert,
}: {
  templateName: string;
  onInsert?: (token: string) => void;
}) {
  const [search, setSearch] = useState("");
  const entry = templateVariableRegistry[templateName];
  const variables = useMemo(
    () =>
      entry?.variables.filter((variable) => matchesSearch(variable, search)) ??
      [],
    [entry, search],
  );

  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <div className="border-b border-[rgb(var(--color-border-200))] p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
              Template variables
            </h3>
            <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
              {onInsert
                ? "Select a variable to insert it."
                : "Variables available to this template."}
            </p>
          </div>
          <Badge size="sm" variant="info">
            {entry?.variables.length ?? 0}
          </Badge>
        </div>
        {entry?.contractInferred && (
          <div className="mt-2 rounded-md border border-[rgb(var(--badge-warning-border))] bg-[rgb(var(--badge-warning-bg))] px-2 py-1.5 text-xs text-[rgb(var(--badge-warning-text))]">
            Not currently sent. This contract is inferred from the template.
          </div>
        )}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[rgb(var(--color-text-400))]" />
          <Input
            id={`template-variable-search-${templateName}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search variables"
            className="pl-8"
          />
        </div>
      </div>
      <div className="max-h-[34rem] min-h-0 overflow-y-auto px-3">
        {variables.map((variable) => (
          <VariableRow
            key={variable.path}
            variable={variable}
            rowId={`template-variable-${templateName}-${variable.path.replace(/[^a-zA-Z0-9]+/g, "-")}`}
            onInsert={onInsert}
          />
        ))}
        {variables.length === 0 && (
          <p className="py-8 text-center text-sm text-[rgb(var(--color-text-500))]">
            No matching variables.
          </p>
        )}
      </div>
    </aside>
  );
}

type GroupedVariable = {
  category: string;
  variable: VariableDef;
  templates: string[];
};

export function VariableReferenceDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const grouped = useMemo(() => {
    const groups = new Map<string, GroupedVariable>();
    for (const [templateName, entry] of Object.entries(
      templateVariableRegistry,
    )) {
      if (category !== "all" && entry.category !== category) continue;
      for (const variable of entry.variables) {
        if (!matchesSearch(variable, search)) continue;
        const key = `${entry.category}\u0000${variable.path}\u0000${variable.description}`;
        const existing = groups.get(key);
        if (existing) existing.templates.push(templateName);
        else
          groups.set(key, {
            category: entry.category,
            variable,
            templates: [templateName],
          });
      }
    }
    return [...groups.values()].sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.variable.path.localeCompare(right.variable.path),
    );
  }, [category, search]);

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <a
        href={DOCUMENTATION_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline dark:text-primary-300"
      >
        Read the complete guide <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <Button
        id="close-variable-reference-dialog"
        type="button"
        onClick={onClose}
      >
        Close
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Email template variable reference"
      className="max-w-4xl"
      footer={footer}
    >
      <DialogContent>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          Find the data available to each system email template. Copy the exact
          Handlebars token into a custom template.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
          <Input
            id="global-template-variable-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search paths, descriptions, and concepts"
          />
          <CustomSelect
            id="global-template-variable-category"
            value={category}
            onValueChange={setCategory}
            options={[
              { value: "all", label: "All areas" },
              ...templateVariableCategories.map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
        </div>
        <div className="mt-4 max-h-[58vh] overflow-y-auto rounded-lg border border-[rgb(var(--color-border-200))] px-4">
          {grouped.map(
            ({ category: rowCategory, variable, templates }, index) => (
              <div
                key={`${rowCategory}-${variable.path}-${variable.description}`}
              >
                {(index === 0 ||
                  grouped[index - 1].category !== rowCategory) && (
                  <div className="sticky top-0 z-10 -mx-4 border-y border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-600))] first:border-t-0">
                    {rowCategory}
                  </div>
                )}
                <VariableRow
                  variable={variable}
                  rowId={`global-variable-${index}-${variable.path.replace(/[^a-zA-Z0-9]+/g, "-")}`}
                  appliesTo={templates}
                />
              </div>
            ),
          )}
          {grouped.length === 0 && (
            <p className="py-10 text-center text-sm text-[rgb(var(--color-text-500))]">
              No matching variables.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function getTemplateVariableCompletions(
  templateName: string,
  query: string,
): VariableDef[] {
  return (templateVariableRegistry[templateName]?.variables ?? [])
    .filter((variable) =>
      variable.path.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 8);
}

export { tokenFor as getTemplateVariableToken };
