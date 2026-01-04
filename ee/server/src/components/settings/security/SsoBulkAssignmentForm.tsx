"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "server/src/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { DataTable } from "server/src/components/ui/DataTable";
import { ColumnDefinition } from "server/src/interfaces/dataTable.interfaces";
import { Alert, AlertDescription } from "server/src/components/ui/Alert";
import { Badge } from "server/src/components/ui/Badge";
import { Input } from "server/src/components/ui/Input";
import { Label } from "server/src/components/ui/Label";
import { Checkbox } from "server/src/components/ui/Checkbox";
import Spinner from "server/src/components/ui/Spinner";
import { Loader2, Search } from "lucide-react";
import { useToast } from "server/src/hooks/use-toast";
import { ToggleGroup, ToggleGroupItem } from "server/src/components/ui/ToggleGroup";
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

function formatProviderName(provider: LinkProvider): string {
  return provider === "microsoft" ? "Microsoft 365" : "Google Workspace";
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
  const isTop = location === "top";
  const actionLabel = mode === "unlink" ? "Unlink accounts" : "Link accounts";
  const previewLabel = mode === "unlink" ? "Preview unlink" : "Preview assignment";
  return (
    <div className="flex flex-wrap gap-3" aria-label={`Bulk SSO actions ${location}`}>
      <Button
        id={`sso-bulk-${location}-preview-${mode}-button`}
        type="button"
        variant={isTop ? "secondary" : "outline"}
        onClick={onPreview}
        disabled={disableActions}
      >
        {isPending && lastMode === "preview" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing preview…
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
            {mode === "unlink" ? "Unlinking accounts…" : "Linking accounts…"}
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
          setTableError(response.error ?? "Unable to load assignable users.");
          return;
        }

        setUsers(response.users);
        setTotalItems(response.pagination?.totalItems ?? response.users.length);
      } catch (error: any) {
        if (!cancelled) {
          setUsers([]);
          setTotalItems(0);
          setTableError(error?.message ?? "Unable to load assignable users.");
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
        title: "Provider required",
        variant: "destructive",
        description: "Select a configured provider before continuing.",
      });
      return;
    }

    if (request.userIds.length === 0) {
      toast({
        title: "No users selected",
        variant: "destructive",
        description: "Select at least one user from the table.",
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
          title: "Bulk assignment failed",
          variant: "destructive",
          description: response.error ?? "Unable to process SSO bulk assignment.",
        });
        return;
      }

      setResult(response.result);
      setLastMode(mode);

      const affectedCount = response.result.summary.providers.reduce(
        (total, provider) => total + provider.linked,
        0,
      );

      toast({
        title: mode === "execute"
          ? request.mode === "unlink"
            ? "Unlink complete"
            : "Link complete"
          : "Preview ready",
        description:
          mode === "execute"
            ? request.mode === "unlink"
              ? `Unlinked ${affectedCount} accounts via ${formatProviderName(request.providers[0] as LinkProvider)}.`
              : `Linked ${affectedCount} accounts via ${formatProviderName(request.providers[0] as LinkProvider)}.`
            : request.mode === "unlink"
              ? `Preview ready. We'll unlink ${request.userIds.length} selected user${request.userIds.length === 1 ? '' : 's'}.`
              : `Preview ready. Review the summary before linking accounts.`,
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
      title: "Email",
      dataIndex: "email",
      width: "30%",
      render: (email: string | null, record: SsoAssignableUser) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{email || "—"}</span>
          <span className="text-xs text-muted-foreground">ID: {record.userId}</span>
        </div>
      ),
    },
    {
      title: "Name",
      dataIndex: "displayName",
      width: "20%",
      render: (displayName: string | null) => displayName || "—",
    },
    {
      title: "Status",
      dataIndex: "inactive",
      width: "12%",
      render: (inactive: boolean) => (
        <div className="flex flex-wrap gap-2">
          {inactive ? (
            <Badge variant="error">Inactive</Badge>
          ) : (
            <Badge variant="secondary">Active</Badge>
          )}
        </div>
      ),
    },
    {
      title: "Linked providers",
      dataIndex: "linkedProviders",
      width: "18%",
      sortable: false,
      render: (linkedProviders: string[], record: SsoAssignableUser) => {
        if (linkedProviders.length === 0) {
          return <Badge variant="outline">Unlinked</Badge>;
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
      title: "Last login",
      dataIndex: "lastLoginAt",
      width: "15%",
      render: (lastLoginAt: string | null) => formatDate(lastLoginAt),
    },
  ];

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Choose provider & select users</CardTitle>
          <CardDescription>
            Pick the configured SSO provider for your staff, then search and select the users who should be linked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="block text-sm font-medium text-muted-foreground">Provider</Label>
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
                        Not configured
                      </Badge>
                    )}
                  </Button>
                );
              })}
          </div>
            {!selectedProviderConfigured && (
              <Alert variant="info" className="mt-4">
                <AlertDescription>
                  Provide OAuth credentials for this provider before linking accounts.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-3">
            <Label className="block text-sm font-medium text-muted-foreground">Action</Label>
            <ToggleGroup
              type="single"
              value={assignmentMode}
              onValueChange={(value) => {
                if (value === "link" || value === "unlink") {
                  setAssignmentMode(value);
                }
              }}
              className="justify-start"
              aria-label="Select SSO bulk action"
            >
              <ToggleGroupItem value="link" disabled={isPending}>
                Link selected users
              </ToggleGroupItem>
              <ToggleGroupItem value="unlink" disabled={isPending}>
                Unlink selected users
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-sm text-muted-foreground">
              Linking adds the provider to each selected user. Unlinking removes the provider so the user returns to password/TOTP sign-in until they link again.
            </p>
          </div>

          <div className="space-y-3">
            <Label htmlFor="sso-search" className="block text-sm font-medium text-muted-foreground">
              Find internal users
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="sso-search"
                placeholder="Search by email or name"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                disabled={tableLoading && users.length === 0}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                {selectionCount === 0
                  ? "No users selected yet."
                  : `${selectionCount} user${selectionCount === 1 ? '' : 's'} selected.`}
              </span>
              {selectionCount > 0 && (
                <Button
                  id="bulk-sso-clear-selection-button"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                >
                  Clear selection
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
                <p className="mt-4 text-sm text-muted-foreground">Loading users...</p>
              </div>
            ) : users.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {searchQuery ? "No users match this search." : "No internal users found."}
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
              Client portal bulk assignments are coming soon. For now, this tool applies only to internal MSP users.
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
                {lastMode === "execute" ? "Assignment complete" : "Preview results"}
              </CardTitle>
              <CardDescription>
                {result.summary.scannedUsers === 0
                  ? "None of the selected users matched the current filters."
                  : `Processed ${result.summary.scannedUsers} user${result.summary.scannedUsers === 1 ? '' : 's'}.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {summaryProviders.map((summary) => {
                  const actionLabel = activeResultMode === "unlink"
                    ? lastMode === "execute"
                      ? "Unlinked"
                      : "Would unlink"
                    : lastMode === "execute"
                      ? "Linked"
                      : "Would link";
                  const alreadyLabel = activeResultMode === "unlink" ? "Already unlinked" : "Already linked";
                  return (
                    <div
                      key={summary.provider}
                      className="rounded-lg border border-muted-foreground/20 p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">
                          {formatProviderName(summary.provider as LinkProvider)}
                        </p>
                        <Badge variant="secondary">{summary.candidates} selected</Badge>
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
                          <dt>Skipped (inactive)</dt>
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
