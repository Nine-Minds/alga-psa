"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@alga-psa/ui/components/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import { DataTable } from "@alga-psa/ui/components/DataTable";
import { ColumnDefinition } from "server/src/interfaces/dataTable.interfaces";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { Badge } from "@alga-psa/ui/components/Badge";
import { Input } from "@alga-psa/ui/components/Input";
import { Label } from "@alga-psa/ui/components/Label";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import Spinner from "@alga-psa/ui/components/Spinner";
import { Loader2, Search } from "lucide-react";
import { useToast } from "server/src/hooks/use-toast";
import ViewSwitcher from "@alga-psa/ui/components/ViewSwitcher";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import {
  executeBulkSsoAssignmentAction,
  previewBulkSsoAssignmentAction,
  listSsoAssignableUsersAction,
  type ListSsoAssignableUsersResponse,
  type SsoAssignableUser,
  type SsoBulkAssignmentActionResponse,
  type SsoBulkAssignmentProviderSummary,
  type SsoBulkAssignmentRequest,
  type SsoBulkAssignmentResult,
} from "@ee/lib/actions/ssoActions";

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  configured: boolean;
}

interface SsoBulkAssignmentFormProps {
  providerOptions: ProviderOption[];
}

type LinkProvider = "google" | "microsoft";
type AssignmentMode = "link" | "unlink";

const SEARCH_DEBOUNCE_MS = 350;

function normalizeProvider(id: string): LinkProvider | null {
  if (id === "google") return "google";
  if (id === "microsoft" || id === "azure-ad") return "microsoft";
  return null;
}

function buildRequest(
  provider: LinkProvider | null,
  selectedUserIds: Set<string>,
  mode: AssignmentMode,
): SsoBulkAssignmentRequest {
  return {
    providers: provider ? [provider] : [],
    userIds: Array.from(selectedUserIds),
    userType: "internal",
    mode,
  };
}

function useFormatProviderName() {
  const { t } = useTranslation("msp/settings");
  return (provider: LinkProvider): string =>
    provider === "microsoft"
      ? t("ssoBulk.form.providerNames.microsoft")
      : t("ssoBulk.form.providerNames.google");
}

function ActionButtons({
  disableActions,
  isPending,
  lastMode,
  onPreview,
  onExecute,
  location = "bottom",
  mode,
}: {
  disableActions: boolean;
  isPending: boolean;
  lastMode: "preview" | "execute" | null;
  onPreview: () => void;
  onExecute: () => void;
  location?: "top" | "bottom";
  mode: AssignmentMode;
}) {
  const { t } = useTranslation("msp/settings");
  const isTop = location === "top";
  const actionLabel = mode === "unlink"
    ? t("ssoBulk.form.actions.unlink")
    : t("ssoBulk.form.actions.link");
  const previewLabel = mode === "unlink"
    ? t("ssoBulk.form.actions.previewUnlink")
    : t("ssoBulk.form.actions.previewLink");
  return (
    <div className="flex flex-wrap gap-3" aria-label={t("ssoBulk.form.actions.bulkLabel", { location })}>
      <Button
        id={`sso-bulk-${location}-preview-${mode}-button`}
        type="button"
        variant={isTop ? "secondary" : "outline"}
        onClick={onPreview}
        disabled={disableActions}
      >
        {isPending && lastMode === "preview" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("ssoBulk.form.actions.preparingPreview")}
          </>
        ) : (
          previewLabel
        )}
      </Button>
      <Button
        id={`sso-bulk-${location}-execute-${mode}-button`}
        type="button"
        onClick={onExecute}
        disabled={disableActions}
      >
        {isPending && lastMode === "execute" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {mode === "unlink"
              ? t("ssoBulk.form.actions.unlinking")
              : t("ssoBulk.form.actions.linking")}
          </>
        ) : (
          actionLabel
        )}
      </Button>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SsoBulkAssignmentForm({ providerOptions }: SsoBulkAssignmentFormProps) {
  const { t } = useTranslation("msp/settings");
  const formatProviderName = useFormatProviderName();
  const providerMetadata = useMemo(() => {
    const map = new Map<LinkProvider, ProviderOption>();
    providerOptions.forEach((option) => {
      const normalized = normalizeProvider(option.id);
      if (normalized) {
        map.set(normalized, option);
      }
    });
    return map;
  }, [providerOptions]);

  const configuredProviders = useMemo(
    () =>
      Array.from(providerMetadata.entries())
        .filter(([, option]) => option.configured)
        .map(([provider]) => provider),
    [providerMetadata],
  );

  const fallbackProviders = useMemo(
    () => Array.from(providerMetadata.keys()),
    [providerMetadata],
  );

  const initialProvider = configuredProviders[0] ?? fallbackProviders[0] ?? null;

  const [selectedProvider, setSelectedProvider] = useState<LinkProvider | null>(initialProvider);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("link");
  const [result, setResult] = useState<SsoBulkAssignmentResult | null>(null);
  const [lastMode, setLastMode] = useState<"preview" | "execute" | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);
  const [users, setUsers] = useState<SsoAssignableUser[]>([]);
  const [tableRefreshKey, setTableRefreshKey] = useState(0);

  useEffect(() => {
    if (!selectedProvider) {
      setSelectedProvider(configuredProviders[0] ?? fallbackProviders[0] ?? null);
    }
  }, [selectedProvider, configuredProviders, fallbackProviders]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setTableLoading(true);
      setTableError(null);

      try {
        const response: ListSsoAssignableUsersResponse = await listSsoAssignableUsersAction({
          search: searchQuery,
          page,
          pageSize,
        });

        if (cancelled) {
          return;
        }

        if (!response.success || !response.users) {
          setUsers([]);
          setTotalItems(0);
          setTableError(response.error ?? t("ssoBulk.form.loadUsersFailed"));
          return;
        }

        setUsers(response.users);
        setTotalItems(response.pagination?.totalItems ?? response.users.length);
      } catch (error: any) {
        if (!cancelled) {
          setUsers([]);
          setTotalItems(0);
          setTableError(error?.message ?? t("ssoBulk.form.loadUsersFailed"));
        }
      } finally {
        if (!cancelled) {
          setTableLoading(false);
        }
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [searchQuery, page, pageSize, tableRefreshKey]);

  const selectedProviderConfigured =
    selectedProvider !== null ? providerMetadata.get(selectedProvider)?.configured ?? false : false;

  const selectionCount = selectedUserIds.size;
  // With server-side pagination, users array already contains only current page items
  const currentPageIds = users.map((user) => user.userId);
  const selectedOnPage = currentPageIds.filter((id) => selectedUserIds.has(id));
  const isAllOnPageSelected = currentPageIds.length > 0 && selectedOnPage.length === currentPageIds.length;
  const isSomeOnPageSelected = selectedOnPage.length > 0 && !isAllOnPageSelected;

  const toggleUserSelection = (userId: string, checked: boolean) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  };

  const toggleCurrentPage = (checked: boolean) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      currentPageIds.forEach((id) => {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      });
      return next;
    });
  };

  const clearSelection = () => setSelectedUserIds(new Set());

  const runAction = (mode: "preview" | "execute") => {
    const request = buildRequest(selectedProvider, selectedUserIds, assignmentMode);

    if (request.providers.length === 0) {
      toast({
        title: t("ssoBulk.form.toast.providerRequiredTitle"),
        variant: "destructive",
        description: t("ssoBulk.form.toast.providerRequiredDescription"),
      });
      return;
    }

    if (request.userIds.length === 0) {
      toast({
        title: t("ssoBulk.form.toast.noUsersTitle"),
        variant: "destructive",
        description: t("ssoBulk.form.toast.noUsersDescription"),
      });
      return;
    }

    startTransition(async () => {
      let response: SsoBulkAssignmentActionResponse;

      if (mode === "preview") {
        response = await previewBulkSsoAssignmentAction(request);
      } else {
        response = await executeBulkSsoAssignmentAction(request);
      }

      if (!response.success || !response.result) {
        toast({
          title: t("ssoBulk.form.toast.failedTitle"),
          variant: "destructive",
          description: response.error ?? t("ssoBulk.form.toast.failedDescription"),
        });
        return;
      }

      setResult(response.result);
      setLastMode(mode);

      const affectedCount = response.result.summary.providers.reduce(
        (total, provider) => total + provider.linked,
        0,
      );

      const providerName = formatProviderName(request.providers[0] as LinkProvider);

      toast({
        title: mode === "execute"
          ? request.mode === "unlink"
            ? t("ssoBulk.form.toast.unlinkCompleteTitle")
            : t("ssoBulk.form.toast.linkCompleteTitle")
          : t("ssoBulk.form.toast.previewReadyTitle"),
        description:
          mode === "execute"
            ? request.mode === "unlink"
              ? t("ssoBulk.form.toast.unlinkedCount", { count: affectedCount, provider: providerName })
              : t("ssoBulk.form.toast.linkedCount", { count: affectedCount, provider: providerName })
            : request.mode === "unlink"
              ? t("ssoBulk.form.toast.previewUnlink", { count: request.userIds.length })
              : t("ssoBulk.form.toast.previewLink"),
      });

      if (mode === "execute") {
        clearSelection();
        setTableRefreshKey((key) => key + 1);
      }
    });
  };

  const handlePreview = () => runAction("preview");
  const handleExecute = () => runAction("execute");

  const summaryProviders: SsoBulkAssignmentProviderSummary[] = result?.summary.providers ?? [];
  const activeResultMode: AssignmentMode = result?.mode ?? assignmentMode;

  const disableActions =
    isPending || !selectedProvider || !selectedProviderConfigured || selectedUserIds.size === 0;

  const handlePageChange = (newPage: number) => setPage(newPage);
  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  const userTableColumns: ColumnDefinition<SsoAssignableUser>[] = [
    {
      title: (
        <Checkbox
          skipRegistration
          checked={isAllOnPageSelected}
          indeterminate={isSomeOnPageSelected}
          onChange={(event) => toggleCurrentPage(event.target.checked)}
          disabled={users.length === 0}
        />
      ),
      dataIndex: "checkbox",
      width: "5%",
      sortable: false,
      render: (_: unknown, record: SsoAssignableUser) => {
        const isChecked = selectedUserIds.has(record.userId);
        return (
          <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
            <Checkbox
              skipRegistration
              checked={isChecked}
              onChange={(event) => toggleUserSelection(record.userId, event.target.checked)}
            />
          </div>
        );
      },
    },
    {
      title: t("ssoBulk.form.table.email"),
      dataIndex: "email",
      width: "30%",
      render: (email: string | null, record: SsoAssignableUser) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{email || "—"}</span>
          <span className="text-xs text-muted-foreground">{t("ssoBulk.form.table.id")}: {record.userId}</span>
        </div>
      ),
    },
    {
      title: t("ssoBulk.form.table.name"),
      dataIndex: "displayName",
      width: "20%",
      render: (displayName: string | null) => displayName || "—",
    },
    {
      title: t("ssoBulk.form.table.status"),
      dataIndex: "inactive",
      width: "12%",
      render: (inactive: boolean) => (
        <div className="flex flex-wrap gap-2">
          {inactive ? (
            <Badge variant="error">{t("ssoBulk.form.table.inactive")}</Badge>
          ) : (
            <Badge variant="secondary">{t("ssoBulk.form.table.active")}</Badge>
          )}
        </div>
      ),
    },
    {
      title: t("ssoBulk.form.table.linkedProviders"),
      dataIndex: "linkedProviders",
      width: "18%",
      sortable: false,
      render: (linkedProviders: string[], record: SsoAssignableUser) => {
        if (linkedProviders.length === 0) {
          return <Badge variant="outline">{t("ssoBulk.form.table.unlinked")}</Badge>;
        }
        return (
          <div className="flex flex-wrap gap-2">
            {linkedProviders.map((provider) => (
              <Badge key={`${record.userId}-${provider}`} variant="secondary">
                {formatProviderName(provider as LinkProvider)}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      title: t("ssoBulk.form.table.lastLogin"),
      dataIndex: "lastLoginAt",
      width: "15%",
      render: (lastLoginAt: string | null) => formatDate(lastLoginAt),
    },
  ];

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("ssoBulk.form.title")}</CardTitle>
          <CardDescription>
            {t("ssoBulk.form.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="block text-sm font-medium text-muted-foreground">{t("ssoBulk.form.providerLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              {Array.from(providerMetadata.entries()).map(([provider, option]) => {
                const selected = selectedProvider === provider;
                return (
                  <Button
                    key={provider}
                    id={`bulk-sso-provider-${provider}-button`}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    onClick={() => {
                      setSelectedProvider(provider);
                    }}
                    disabled={!option.configured || isPending}
                  >
                    {option.name}
                    {!option.configured && (
                      <Badge className="ml-2" variant="secondary">
                        {t("ssoBulk.form.notConfigured")}
                      </Badge>
                    )}
                  </Button>
                );
              })}
            </div>
            {!selectedProviderConfigured && (
              <Alert variant="info" className="mt-4">
                <AlertDescription>
                  {t("ssoBulk.form.providerNotConfiguredAlert")}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-3">
            <Label className="block text-sm font-medium text-muted-foreground">{t("ssoBulk.form.actionLabel")}</Label>
            <ViewSwitcher
              currentView={assignmentMode}
              onChange={(value) => {
                if (value === "link" || value === "unlink") {
                  setAssignmentMode(value);
                }
              }}
              options={[
                { value: "link" as AssignmentMode, label: t("ssoBulk.form.linkSelected"), disabled: isPending },
                { value: "unlink" as AssignmentMode, label: t("ssoBulk.form.unlinkSelected"), disabled: isPending },
              ]}
              aria-label={t("ssoBulk.form.actionPlaceholder")}
            />
            <p className="text-sm text-muted-foreground">
              {t("ssoBulk.form.actionDescription")}
            </p>
          </div>

          <div className="space-y-3">
            <Label htmlFor="sso-search" className="block text-sm font-medium text-muted-foreground">
              {t("ssoBulk.form.searchLabel")}
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="sso-search"
                placeholder={t("ssoBulk.form.searchPlaceholder")}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                disabled={tableLoading && users.length === 0}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                {selectionCount === 0
                  ? t("ssoBulk.form.noneSelected")
                  : t("ssoBulk.form.selected", { count: selectionCount })}
              </span>
              {selectionCount > 0 && (
                <Button
                  id="bulk-sso-clear-selection-button"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                >
                  {t("ssoBulk.form.clearSelection")}
                </Button>
              )}
            </div>

            <ActionButtons
              disableActions={disableActions}
              isPending={isPending}
              lastMode={lastMode}
              onPreview={handlePreview}
              onExecute={handleExecute}
              location="top"
              mode={assignmentMode}
            />

            {tableError && (
              <Alert variant="destructive">
                <AlertDescription>{tableError}</AlertDescription>
              </Alert>
            )}

            {tableLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Spinner size="sm" />
                <p className="mt-4 text-sm text-muted-foreground">{t("ssoBulk.form.loadingUsers")}</p>
              </div>
            ) : users.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {searchQuery ? t("ssoBulk.form.noMatch") : t("ssoBulk.form.noUsers")}
              </div>
            ) : (
              <DataTable
                key={`${page}-${pageSize}`}
                id="sso-bulk-users-table"
                data={users}
                columns={userTableColumns}
                pagination={true}
                currentPage={page}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={handlePageChange}
                onItemsPerPageChange={handlePageSizeChange}
              />
            )}
          </div>

          <Alert variant="info">
            <AlertDescription>
              {t("ssoBulk.form.clientPortalComing")}
            </AlertDescription>
          </Alert>

        </CardContent>
      </Card>

      <div className="space-y-6">
        {result && (
          <>
          <Card>
            <CardHeader>
              <CardTitle>
                {lastMode === "execute" ? t("ssoBulk.form.results.completeTitle") : t("ssoBulk.form.results.previewTitle")}
              </CardTitle>
              <CardDescription>
                {result.summary.scannedUsers === 0
                  ? t("ssoBulk.form.results.noneMatched")
                  : t("ssoBulk.form.results.processed", { count: result.summary.scannedUsers })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {summaryProviders.map((summary) => {
                  const actionLabel = activeResultMode === "unlink"
                    ? lastMode === "execute"
                      ? t("ssoBulk.form.results.unlinked")
                      : t("ssoBulk.form.results.wouldUnlink")
                    : lastMode === "execute"
                      ? t("ssoBulk.form.results.linked")
                      : t("ssoBulk.form.results.wouldLink");
                  const alreadyLabel = activeResultMode === "unlink"
                    ? t("ssoBulk.form.results.alreadyUnlinked")
                    : t("ssoBulk.form.results.alreadyLinked");
                  return (
                    <div
                      key={summary.provider}
                      className="rounded-lg border border-muted-foreground/20 p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">
                          {formatProviderName(summary.provider as LinkProvider)}
                        </p>
                        <Badge variant="secondary">{t("ssoBulk.form.results.candidatesSelected", { count: summary.candidates })}</Badge>
                      </div>
                      <dl className="mt-3 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt>{actionLabel}</dt>
                          <dd className="font-semibold">{summary.linked}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>{alreadyLabel}</dt>
                          <dd>{summary.alreadyLinked}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>{t("ssoBulk.form.results.skippedInactive")}</dt>
                          <dd>{summary.skippedInactive}</dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          </>
        )}
        <ActionButtons
          disableActions={disableActions}
          isPending={isPending}
          lastMode={lastMode}
          onPreview={handlePreview}
          onExecute={handleExecute}
          location="bottom"
          mode={assignmentMode}
        />
      </div>
    </div>
  );
}
