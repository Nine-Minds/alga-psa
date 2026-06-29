"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import styles from "../status.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ManageStatus = {
  app: {
    version: string;
    channel: "stable" | "nightly";
    updateAvailable: boolean;
    availableVersion?: string | null;
    pinnedReleaseDigest?: string | null;
    resolvedReleaseDigest?: string | null;
    update: { status: "idle" | "running" | "complete" | "blocked"; message: string | null };
  };
  controlPlane: {
    channel: string;
    runningDigest: string | null;
    resolvedDigest: string | null;
    upgradeAvailable: boolean;
    upgrade: { status: "idle" | "running" | "complete" | "blocked"; message: string | null };
  };
  license: {
    edition: string | null;
    expiresAt: string | null;
    perpetual: boolean;
    status: "active" | "expired" | "unknown";
  };
  appUrl: {
    url: string | null;
    host: string | null;
    dnsMode: "system" | "custom";
    dnsServers: string[];
  };
};

type ManageTab = "updates" | "control-plane" | "license" | "settings";

function apiPath(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "")
      search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

// ---------------------------------------------------------------------------
// Sub-tab components
// ---------------------------------------------------------------------------

function UpdatesTab({
  status,
  onRefresh,
}: {
  status: ManageStatus;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    // Stop polling if the status returned from parent shows terminal state.
    const updateStatus = status.app.update.status;
    if (busy && (updateStatus === "complete" || updateStatus === "blocked")) {
      stopPoll();
      setBusy(false);
      setResult(
        updateStatus === "complete"
          ? "Update complete."
          : `Update blocked: ${status.app.update.message || "unknown reason"}`,
      );
    }
  }, [busy, status.app.update.status, status.app.update.message]);

  // Clean up on unmount.
  useEffect(() => () => stopPoll(), []);

  async function triggerUpdate() {
    setConfirm(false);
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const body = new URLSearchParams({ channel: status.app.channel });
      const response = await fetch(apiPath("/api/updates"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
      });
      if (response.status === 401) { window.location.reload(); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to start update.");
      // Poll until the update status reaches a terminal state.
      pollRef.current = setInterval(onRefresh, 3000);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const app = status.app;
  const updateRunning = app.update.status === "running";
  const updateDone = app.update.status === "complete";
  const updateBlocked = app.update.status === "blocked";

  return (
    <div className={styles.manageSection}>
      <h2>App updates</h2>
      <dl className={styles.kv}>
        <div>
          <dt>Current version</dt>
          <dd>{app.version || "—"}</dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd>{app.channel}</dd>
        </div>
        <div>
          <dt>Update available</dt>
          <dd>
            {app.updateAvailable
              ? `Yes${app.availableVersion ? ` — ${app.availableVersion}` : ""}`
              : "No"}
          </dd>
        </div>
        {(updateRunning || updateDone || updateBlocked || app.update.message) ? (
          <div>
            <dt>Update status</dt>
            <dd>
              <span
                className={`${styles.badge} ${
                  updateDone ? styles.ready : updateBlocked ? styles.failed : styles.installing
                }`}
              >
                {app.update.status}
              </span>
              {app.update.message ? (
                <span className={styles.manageStatusMsg}>{app.update.message}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {error ? <div className={styles.alert}>{error}</div> : null}
      {result ? <p className={styles.manageResult}>{result}</p> : null}

      {!app.updateAvailable && !updateRunning ? (
        <p className={styles.muted}>No update is available on the {app.channel} channel.</p>
      ) : null}

      {app.updateAvailable || updateRunning ? (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.actionButton}
            disabled={busy || updateRunning}
            onClick={() => {
              if (!confirm) { setConfirm(true); }
              else { triggerUpdate(); }
            }}
          >
            {busy || updateRunning
              ? "Updating…"
              : confirm
              ? "Confirm update"
              : "Run update"}
          </button>
          {confirm && !busy && !updateRunning ? (
            <button type="button" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {updateRunning ? (
        <p className={styles.helpText}>
          Update is running. This page will reflect the result when it finishes.
        </p>
      ) : null}
    </div>
  );
}

function ControlPlaneTab({
  status,
  onRefresh,
}: {
  status: ManageStatus;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number | null>(null);
  // Track elapsed since upgrade started for the 3-min timeout.
  const MAX_POLL_MS = 3 * 60 * 1000;

  function stopPoll() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    if (!reconnecting) return;
    const cp = status.controlPlane;
    const upgradeComplete =
      cp.upgrade.status === "complete" &&
      cp.runningDigest &&
      cp.runningDigest === cp.resolvedDigest;
    const upgradeBlocked = cp.upgrade.status === "blocked";
    if (upgradeComplete || upgradeBlocked) {
      stopPoll();
      setReconnecting(false);
      setBusy(false);
      setResult(
        upgradeComplete
          ? "Control-plane upgraded successfully."
          : `Upgrade blocked: ${cp.upgrade.message || "unknown reason"}`,
      );
    }
  }, [reconnecting, status.controlPlane]);

  useEffect(() => () => stopPoll(), []);

  async function triggerUpgrade() {
    setConfirm(false);
    setBusy(true);
    setReconnecting(false);
    setResult(null);
    setError(null);
    try {
      const response = await fetch(apiPath("/api/control-plane/upgrade"), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) { window.location.reload(); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Older installs ship a host-agent that predates the in-place upgrade
        // route (/v1/control-plane/upgrade), so this POST comes back as a relayed
        // 404 {"error":"not found"}. The host-agent is a host systemd service
        // baked at install — it is NOT delivered via the OCI release channel, so a
        // channel/control-plane bump can't add the route. A reboot applies the
        // channel's current control-plane image via the boot bootstrap, which
        // doesn't go through the host-agent.
        if (response.status === 404 && String(data.error || "").toLowerCase() === "not found") {
          throw new Error(
            "This appliance's host agent predates in-place control-plane upgrade, so the upgrade button can't apply it. Reboot the appliance to apply the latest control plane — the boot process pulls it directly (no host agent needed).",
          );
        }
        throw new Error(data.error || "Failed to start upgrade.");
      }
      setReconnecting(true);
      pollStartRef.current = Date.now();
      // Poll every 3 s, tolerating fetch failures while the pod restarts.
      pollRef.current = setInterval(async () => {
        const elapsed = Date.now() - (pollStartRef.current ?? Date.now());
        if (elapsed > MAX_POLL_MS) {
          stopPoll();
          setReconnecting(false);
          setBusy(false);
          setError(
            "Timed out waiting for the control plane to return. If the UI does not return, run `sudo alga-control-plane-reapply` on the appliance host.",
          );
          return;
        }
        try {
          await onRefresh();
        } catch {
          // Tolerate errors during the restart window — keep retrying.
        }
      }, 3000);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const cp = status.controlPlane;
  const upgradeAvailable = cp.upgradeAvailable;
  const upgradeRunning = cp.upgrade.status === "running";
  const upgradeDone = cp.upgrade.status === "complete";
  const upgradeBlocked = cp.upgrade.status === "blocked";

  return (
    <div className={styles.manageSection}>
      <h2>Control-plane upgrade</h2>
      <dl className={styles.kv}>
        <div>
          <dt>Channel</dt>
          <dd>{cp.channel || "—"}</dd>
        </div>
        <div>
          <dt>Running digest</dt>
          <dd>
            <code>{cp.runningDigest ? cp.runningDigest.slice(0, 19) + "…" : "—"}</code>
          </dd>
        </div>
        <div>
          <dt>Resolved digest</dt>
          <dd>
            <code>{cp.resolvedDigest ? cp.resolvedDigest.slice(0, 19) + "…" : "—"}</code>
          </dd>
        </div>
        <div>
          <dt>Upgrade available</dt>
          <dd>{upgradeAvailable ? "Yes" : "No"}</dd>
        </div>
        {(upgradeRunning || upgradeDone || upgradeBlocked || cp.upgrade.message) ? (
          <div>
            <dt>Upgrade status</dt>
            <dd>
              <span
                className={`${styles.badge} ${
                  upgradeDone ? styles.ready : upgradeBlocked ? styles.failed : styles.installing
                }`}
              >
                {cp.upgrade.status}
              </span>
              {cp.upgrade.message ? (
                <span className={styles.manageStatusMsg}>{cp.upgrade.message}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {error ? <div className={styles.alert}>{error}</div> : null}
      {result ? <p className={styles.manageResult}>{result}</p> : null}

      {reconnecting ? (
        <div className={`${styles.alert} ${styles.alertInfo}`}>
          Upgrading the control plane… reconnecting. The UI will return shortly.
          <br />
          <small>
            If the UI does not return, run <code>sudo alga-control-plane-reapply</code> on the appliance host.
          </small>
        </div>
      ) : null}

      {!upgradeAvailable ? (
        <p className={styles.muted}>Control plane is up to date.</p>
      ) : null}

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.actionButton}
          disabled={busy || !upgradeAvailable || upgradeRunning || reconnecting}
          onClick={() => {
            if (!confirm) { setConfirm(true); }
            else { triggerUpgrade(); }
          }}
        >
          {busy || reconnecting
            ? "Upgrading…"
            : !upgradeAvailable
            ? "Up to date"
            : confirm
            ? "Confirm upgrade"
            : "Upgrade control plane"}
        </button>
        {confirm && !busy && !reconnecting ? (
          <button type="button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LicenseTab({
  status,
  onRefresh,
}: {
  status: ManageStatus;
  onRefresh: () => Promise<void>;
}) {
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => () => stopPoll(), []);

  async function applyLicense() {
    setConfirm(false);
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch(apiPath("/api/license/apply"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ licenseKey: licenseKey.trim() }),
        cache: "no-store",
      });
      if (response.status === 401) { window.location.reload(); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to apply license.");
      setResult("License applied. The app is restarting to apply the change.");
      setLicenseKey("");
      // Poll to pick up the refreshed license status after restart.
      pollRef.current = setInterval(async () => {
        try { await onRefresh(); } catch { /* tolerate restart gap */ }
      }, 3000);
      setTimeout(() => { stopPoll(); setBusy(false); }, 30000);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const lic = status.license;

  function licenseStatusClass() {
    if (lic.status === "active") return styles.ready;
    if (lic.status === "expired") return styles.failed;
    return styles.loading;
  }

  return (
    <div className={styles.manageSection}>
      <h2>License</h2>
      <dl className={styles.kv}>
        <div>
          <dt>Edition</dt>
          <dd>{lic.edition || "—"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`${styles.badge} ${licenseStatusClass()}`}>
              {lic.status}
            </span>
          </dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>
            {lic.perpetual
              ? "Perpetual"
              : lic.expiresAt
                ? new Date(lic.expiresAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "—"}
          </dd>
        </div>
      </dl>

      <div className={styles.manageSeparator} />

      <h3 className={styles.manageSubheading}>Apply a new license key</h3>
      <p className={styles.helpText}>
        Paste the signed JWS license key from Nine Minds. The app will restart to apply it.
      </p>

      <div className={styles.field} style={{ marginTop: "var(--space-md)" }}>
        <label htmlFor="manage-license-key">License key</label>
        <textarea
          id="manage-license-key"
          value={licenseKey}
          onChange={(event) => setLicenseKey(event.target.value)}
          placeholder="eyJhbGci…"
          rows={4}
          disabled={busy}
          style={{ fontFamily: "monospace", fontSize: "0.8rem", resize: "vertical" }}
        />
      </div>

      {error ? <div className={styles.alert}>{error}</div> : null}
      {result ? <p className={styles.manageResult}>{result}</p> : null}

      <div className={styles.toolbar} style={{ marginTop: "var(--space-md)" }}>
        <button
          type="button"
          className={styles.actionButton}
          disabled={busy || !licenseKey.trim()}
          onClick={() => {
            if (!confirm) { setConfirm(true); }
            else { applyLicense(); }
          }}
        >
          {busy ? "Applying…" : confirm ? "Confirm apply" : "Apply license key"}
        </button>
        {confirm && !busy ? (
          <button type="button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SettingsTab({
  status,
  onRefresh,
}: {
  status: ManageStatus;
  onRefresh: () => Promise<void>;
}) {
  const [appHostname, setAppHostname] = useState(status.appUrl.url || "");
  const [dnsMode, setDnsMode] = useState<"system" | "custom">(status.appUrl.dnsMode || "system");
  const [dnsServers, setDnsServers] = useState(status.appUrl.dnsServers?.join(", ") || "");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync fields when status changes (e.g. on first load).
  useEffect(() => {
    setAppHostname(status.appUrl.url || "");
    setDnsMode(status.appUrl.dnsMode || "system");
    setDnsServers(status.appUrl.dnsServers?.join(", ") || "");
  }, [status.appUrl.url, status.appUrl.dnsMode, status.appUrl.dnsServers]);

  function stopPoll() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => () => stopPoll(), []);

  async function saveSettings() {
    setConfirm(false);
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch(apiPath("/api/settings/app-url"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appHostname: appHostname.trim(),
          dnsMode,
          dnsServers: dnsServers.trim(),
        }),
        cache: "no-store",
      });
      if (response.status === 401) { window.location.reload(); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to save settings.");
      setResult("Settings saved. The app is restarting to apply the change.");
      // Poll after restart.
      pollRef.current = setInterval(async () => {
        try { await onRefresh(); } catch { /* tolerate restart gap */ }
      }, 3000);
      setTimeout(() => { stopPoll(); setBusy(false); }, 30000);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className={styles.manageSection}>
      <h2>Settings</h2>

      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label htmlFor="manage-app-hostname">App URL</label>
          <input
            id="manage-app-hostname"
            value={appHostname}
            onChange={(event) => setAppHostname(event.target.value)}
            placeholder="http://192.168.1.50:3000"
            disabled={busy}
          />
          <span className={styles.helpText}>
            Full URL users open in their browser (e.g. http://192.168.1.50:3000).
          </span>
        </div>

        <div className={styles.field}>
          <label htmlFor="manage-dns-mode">DNS mode</label>
          <select
            id="manage-dns-mode"
            value={dnsMode}
            onChange={(event) => setDnsMode(event.target.value as "system" | "custom")}
            disabled={busy}
          >
            <option value="system">Use DHCP/system resolvers</option>
            <option value="custom">Use custom DNS servers</option>
          </select>
          <span className={styles.helpText}>
            Keep system DNS unless this site requires specific internal resolvers.
          </span>
        </div>

        <div className={styles.field}>
          <label htmlFor="manage-dns-servers">Custom DNS servers</label>
          <input
            id="manage-dns-servers"
            value={dnsServers}
            onChange={(event) => setDnsServers(event.target.value)}
            placeholder="8.8.8.8,8.8.4.4"
            disabled={busy || dnsMode !== "custom"}
          />
          <span className={styles.helpText}>
            Comma-separated IPv4 addresses. Required only for custom DNS.
          </span>
        </div>
      </div>

      {error ? <div className={styles.alert}>{error}</div> : null}
      {result ? <p className={styles.manageResult}>{result}</p> : null}

      <p className={styles.helpText} style={{ marginTop: "var(--space-md)" }}>
        Saving these settings restarts the app to apply the change.
      </p>

      <div className={styles.toolbar} style={{ marginTop: "var(--space-md)" }}>
        <button
          type="button"
          className={styles.actionButton}
          disabled={busy}
          onClick={() => {
            if (!confirm) { setConfirm(true); }
            else { saveSettings(); }
          }}
        >
          {busy ? "Saving…" : confirm ? "Confirm save" : "Save settings"}
        </button>
        {confirm && !busy ? (
          <button type="button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ManageView
// ---------------------------------------------------------------------------

const manageTabs: Array<{ value: ManageTab; label: string }> = [
  { value: "updates", label: "Updates" },
  { value: "control-plane", label: "Control-plane" },
  { value: "license", label: "License" },
  { value: "settings", label: "Settings" },
];

export function ManageView() {
  const [activeTab, setActiveTab] = useState<ManageTab>("updates");
  const [manageStatus, setManageStatus] = useState<ManageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Latest poll failed but we still have a prior snapshot to keep showing.
  const [reconnecting, setReconnecting] = useState(false);
  // Mirror of manageStatus, readable inside the (stable) loader closure.
  const manageStatusRef = useRef<ManageStatus | null>(null);

  const loadManageStatus = useCallback(async () => {
    try {
      const response = await fetch(apiPath("/api/manage/status"), {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) throw new Error("Manage status unavailable.");
      const data = (await response.json()) as ManageStatus;
      manageStatusRef.current = data;
      setManageStatus(data);
      setError(null);
      setReconnecting(false);
    } catch (err) {
      // Flux/Helm churn — and the control-plane pod restarting during its own
      // upgrade — make individual status polls fail transiently. Once we have a
      // snapshot, ride the blip out: keep the last-good view and show a quiet
      // "reconnecting" strip instead of replacing the whole Manage UI (and the
      // tabs' own progress banners) with a fatal error. A fatal error is only for
      // the initial load, when there is nothing to show yet.
      // LEVERAGE: pattern appliance-resilient-status-poll — the status page
      // (app/page.tsx) hand-rolls this same "keep last-good snapshot across
      // transient poll failures" behavior separately; a shared usePolledResource
      // hook would unify both surfaces.
      if (manageStatusRef.current) {
        setReconnecting(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadManageStatus();
  }, [loadManageStatus]);

  return (
    <div className={styles.manageView}>
      {/* Sub-tab strip */}
      <div className={styles.manageTabStrip} role="tablist" aria-label="Manage sections">
        {manageTabs.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`manage-tab-${value}`}
            aria-selected={activeTab === value}
            aria-controls={`manage-panel-${value}`}
            className={`${styles.manageTabButton} ${activeTab === value ? styles.manageTabActive : ""}`}
            onClick={() => setActiveTab(value)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={styles.manageRefreshButton}
          onClick={loadManageStatus}
          aria-label="Refresh manage status"
          title="Refresh"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      {/* Loading / error */}
      {loading ? (
        <div className={styles.manageLoading}>
          <div className={styles.skeletonBlock}>
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={styles.skeletonLineDark} />
            ))}
          </div>
        </div>
      ) : error && !manageStatus ? (
        <div className={styles.alert}>{error}</div>
      ) : manageStatus ? (
        <>
          {reconnecting ? (
            <div className={`${styles.alert} ${styles.alertInfo}`}>
              Reconnecting to the appliance… showing the last known status. This is
              expected while services reconcile or the control plane restarts.
            </div>
          ) : null}
          {activeTab === "updates" ? (
            <div
              id="manage-panel-updates"
              role="tabpanel"
              aria-labelledby="manage-tab-updates"
            >
              <UpdatesTab status={manageStatus} onRefresh={loadManageStatus} />
            </div>
          ) : null}
          {activeTab === "control-plane" ? (
            <div
              id="manage-panel-control-plane"
              role="tabpanel"
              aria-labelledby="manage-tab-control-plane"
            >
              <ControlPlaneTab status={manageStatus} onRefresh={loadManageStatus} />
            </div>
          ) : null}
          {activeTab === "license" ? (
            <div
              id="manage-panel-license"
              role="tabpanel"
              aria-labelledby="manage-tab-license"
            >
              <LicenseTab status={manageStatus} onRefresh={loadManageStatus} />
            </div>
          ) : null}
          {activeTab === "settings" ? (
            <div
              id="manage-panel-settings"
              role="tabpanel"
              aria-labelledby="manage-tab-settings"
            >
              <SettingsTab status={manageStatus} onRefresh={loadManageStatus} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
