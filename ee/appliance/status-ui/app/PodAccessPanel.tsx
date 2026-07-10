"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  Cable,
  Clock3,
  Copy,
  Play,
  RefreshCw,
  ShieldAlert,
  SquareTerminal,
  Unplug,
  X,
} from "lucide-react";
import styles from "./status.module.css";

export type AccessNamespace = { name: string };
export type AccessPod = {
  namespace: string;
  name: string;
  phase: string;
  containers: Array<{
    name: string;
    ports?: Array<{
      name?: string | null;
      containerPort: number;
      protocol?: string;
    }>;
  }>;
};

type Capability = {
  state?: string;
  available?: boolean;
  migrated?: boolean;
  message?: string | null;
};

type ActiveForward = {
  id: string;
  namespace: string;
  pod: string;
  container: string;
  bindAddress: string;
  localPort: number;
  remotePort: number;
  address: string;
  state: string;
  activeConnections: number;
  createdAt: string;
  expiresAt: string;
};

type Option = { value: string; label: string };

function AccessDropdown({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  placeholder,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className={styles.dropdown} ref={ref}>
      <button
        type="button"
        className={styles.dropdownButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.dropdownLabel}>
          {selected?.label ?? (value || placeholder || "—")}
        </span>
        <span className={styles.dropdownCaret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && !disabled ? (
        <ul className={styles.dropdownMenu} role="listbox" aria-label={ariaLabel}>
          {options.length ? (
            options.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={`${styles.dropdownOption} ${option.value === value ? styles.dropdownOptionActive : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </li>
            ))
          ) : (
            <li className={styles.dropdownOption} aria-disabled="true">
              No options
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

function remainingLabel(expiresAt: string) {
  const seconds = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function responseError(data: unknown, fallback: string) {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string"
  )
    return data.error;
  return fallback;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      /* Plain HTTP appliance origins may not receive Clipboard API access. */
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export function PodAccessPanel({
  namespace,
  namespaces,
  pods,
  selectedPod,
  selectedContainer,
  loadingNamespaces,
  loadingPods,
  onNamespace,
  onPod,
  onContainer,
  onRefreshPods,
}: {
  namespace: string;
  namespaces: AccessNamespace[];
  pods: AccessPod[];
  selectedPod: string;
  selectedContainer: string;
  loadingNamespaces: boolean;
  loadingPods: boolean;
  onNamespace: (value: string) => void;
  onPod: (value: string) => void;
  onContainer: (value: string) => void;
  onRefreshPods: () => void;
}) {
  const terminalElementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [terminalState, setTerminalState] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [activeShell, setActiveShell] = useState<string | null>(null);
  const [shell, setShell] = useState("auto");
  const [capability, setCapability] = useState<Capability>({
    state: "checking",
    available: false,
    message: "Checking pod-access permissions.",
  });
  const [forwards, setForwards] = useState<ActiveForward[]>([]);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [remotePort, setRemotePort] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [, setClock] = useState(0);

  const selectedPodData = pods.find((pod) => pod.name === selectedPod);
  const selectedContainerData = selectedPodData?.containers.find(
    (container) => container.name === selectedContainer,
  );
  const declaredPorts = useMemo(
    () =>
      (selectedContainerData?.ports || []).filter(
        (port) => !port.protocol || port.protocol === "TCP",
      ),
    [selectedContainerData],
  );
  const terminalActive = terminalState !== "disconnected";

  const loadAccessState = useCallback(async () => {
    try {
      const response = await fetch("/api/k8s/port-forwards", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Unable to load pod access."));
      setCapability(data.capability || { state: "unavailable", available: false });
      setForwards(data.forwards || []);
    } catch (error) {
      setCapability({
        state: "unavailable",
        available: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    loadAccessState();
    const refresh = window.setInterval(loadAccessState, 5000);
    const clock = window.setInterval(() => setClock((value) => value + 1), 1000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(clock);
    };
  }, [loadAccessState]);

  useEffect(() => {
    if (!remotePort && declaredPorts.length) {
      setRemotePort(String(declaredPorts[0].containerPort));
    }
  }, [declaredPorts, remotePort]);

  useEffect(() => {
    if (!terminalElementRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      convertEol: true,
      scrollback: 5000,
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.24,
      theme: {
        background: "#111018",
        foreground: "#e8e4f1",
        cursor: "#b990ff",
        selectionBackground: "#6f3db55c",
        black: "#111018",
        red: "#ff7b8f",
        green: "#72d3a0",
        yellow: "#f1c76f",
        blue: "#7ab8ff",
        magenta: "#c89aff",
        cyan: "#66d7df",
        white: "#e8e4f1",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElementRef.current);
    fitAddon.fit();
    terminal.writeln("\x1b[38;2;185;144;255mAlga appliance pod console\x1b[0m");
    terminal.writeln("Select a running container, then connect.\r\n");
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const input = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: "resize", columns: cols, rows }),
        );
      }
    });
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        /* terminal may be disposing */
      }
    });
    observer.observe(terminalElementRef.current);

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket?.readyState === WebSocket.OPEN) socket.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  function disconnectTerminal() {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    setTerminalState("disconnected");
    setActiveShell(null);
    terminalRef.current?.writeln("\r\n\x1b[38;2;161;153;177mDisconnected.\x1b[0m");
  }

  function connectTerminal() {
    const terminal = terminalRef.current;
    if (!terminal || !selectedPod || !selectedContainer) {
      terminal?.writeln("\x1b[38;2;255;123;143mSelect a pod and container first.\x1b[0m");
      return;
    }
    disconnectTerminal();
    terminal.clear();
    terminal.writeln(
      `\x1b[38;2;161;153;177mConnecting to ${namespace}/${selectedPod} · ${selectedContainer}…\x1b[0m`,
    );
    setTerminalState("connecting");
    fitAddonRef.current?.fit();
    const params = new URLSearchParams({
      namespace,
      pod: selectedPod,
      container: selectedContainer,
      shell,
      columns: String(terminal.cols),
      rows: String(terminal.rows),
    });
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/k8s/exec?${params.toString()}`,
    );
    socketRef.current = socket;
    socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === "output" && typeof message.data === "string") {
        terminal.write(message.data);
      } else if (message.type === "ready") {
        setTerminalState("connected");
        setActiveShell(String(message.shell || shell));
        terminal.focus();
      } else if (message.type === "error") {
        terminal.writeln(
          `\r\n\x1b[38;2;255;123;143m${String(message.message || "Terminal failed.")}\x1b[0m`,
        );
      } else if (message.type === "exit") {
        terminal.writeln(
          `\r\n\x1b[38;2;161;153;177m${String(message.message || "Shell exited.")}\x1b[0m`,
        );
      }
    };
    socket.onerror = () => {
      terminal.writeln(
        "\r\n\x1b[38;2;255;123;143mUnable to open the container shell.\x1b[0m",
      );
    };
    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
      setTerminalState("disconnected");
      setActiveShell(null);
    };
  }

  async function createForward() {
    if (!selectedPod || !selectedContainer || !remotePort) {
      setForwardError("Select a pod, container, and remote port.");
      return;
    }
    setForwardBusy(true);
    setForwardError(null);
    try {
      const response = await fetch("/api/k8s/port-forwards", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          namespace,
          pod: selectedPod,
          container: selectedContainer,
          remotePort,
          localPort: localPort || null,
          durationMinutes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(responseError(data, "Unable to create port forward."));
      setLocalPort("");
      await loadAccessState();
    } catch (error) {
      setForwardError(error instanceof Error ? error.message : String(error));
    } finally {
      setForwardBusy(false);
    }
  }

  async function mutateForward(
    forward: ActiveForward,
    action: "extend" | "stop",
  ) {
    setForwardError(null);
    try {
      const response = await fetch(
        `/api/k8s/port-forwards/${forward.id}${action === "extend" ? "/extend" : ""}`,
        {
          method: action === "extend" ? "POST" : "DELETE",
          credentials: "same-origin",
          headers:
            action === "extend"
              ? { "content-type": "application/json" }
              : undefined,
          body:
            action === "extend"
              ? JSON.stringify({ durationMinutes })
              : undefined,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(responseError(data, `Unable to ${action} port forward.`));
      await loadAccessState();
    } catch (error) {
      setForwardError(error instanceof Error ? error.message : String(error));
    }
  }

  const namespaceOptions = [
    { value: "msp", label: "msp" },
    ...namespaces
      .filter((item) => item.name !== "msp")
      .map((item) => ({ value: item.name, label: item.name })),
  ];

  return (
    <section
      id="appliance-panel-access"
      role="tabpanel"
      aria-labelledby="appliance-tab-access"
      className={styles.accessWorkspace}
    >
      <div className={styles.accessHeader}>
        <div>
          <div className={styles.eyebrow}>Live Kubernetes access</div>
          <h2>Inspect a running container</h2>
          <p>
            Open an ephemeral shell or expose one pod port on the appliance LAN.
            Nothing survives a control-plane restart.
          </p>
        </div>
        <span
          className={`${styles.statusPill} ${capability.available ? styles.ready : capability.state === "checking" ? styles.installing : styles.failed}`}
        >
          {capability.available ? "Access ready" : capability.state || "Unavailable"}
        </span>
      </div>

      {!capability.available && capability.state !== "checking" ? (
        <div className={styles.alert} role="alert">
          {capability.message || "Kubernetes pod-access permission is unavailable."}
        </div>
      ) : null}

      <div className={styles.accessTargetBar}>
        <AccessDropdown
          ariaLabel="Access namespace"
          value={namespace}
          options={namespaceOptions}
          disabled={loadingNamespaces || terminalActive}
          onChange={(value) => {
            onNamespace(value);
            onPod("");
            onContainer("");
          }}
        />
        <AccessDropdown
          ariaLabel="Access pod"
          value={selectedPod}
          options={pods.map((pod) => ({ value: pod.name, label: pod.name }))}
          placeholder="Select pod"
          disabled={loadingPods || terminalActive}
          onChange={(value) => {
            onPod(value);
            const next = pods.find((pod) => pod.name === value);
            onContainer(next?.containers[0]?.name || "");
          }}
        />
        <AccessDropdown
          ariaLabel="Access container"
          value={selectedContainer}
          options={(selectedPodData?.containers || []).map((container) => ({
            value: container.name,
            label: container.name,
          }))}
          placeholder="Select container"
          disabled={loadingPods || terminalActive || !selectedPodData}
          onChange={onContainer}
        />
        <button
          type="button"
          className={styles.iconButton}
          onClick={onRefreshPods}
          disabled={terminalActive}
          aria-label="Refresh pods"
        >
          <RefreshCw aria-hidden="true" />
        </button>
        <span className={styles.targetIdentity}>
          {selectedPodData?.phase || "No pod selected"}
        </span>
      </div>

      <div className={styles.accessGrid}>
        <article className={styles.terminalCard}>
          <header className={styles.terminalToolbar}>
            <div className={styles.terminalTitle}>
              <span className={styles.terminalGlyph}>
                <SquareTerminal aria-hidden="true" />
              </span>
              <div>
                <strong>Container terminal</strong>
                <small>
                  {terminalState === "connected"
                    ? `${namespace}/${selectedPod} · ${activeShell}`
                    : terminalState}
                </small>
              </div>
            </div>
            <div className={styles.terminalActions}>
              <AccessDropdown
                ariaLabel="Shell"
                value={shell}
                disabled={terminalActive}
                onChange={setShell}
                options={[
                  { value: "auto", label: "Auto shell" },
                  { value: "bash", label: "bash" },
                  { value: "sh", label: "sh" },
                ]}
              />
              {terminalActive ? (
                <button type="button" onClick={disconnectTerminal}>
                  <Unplug aria-hidden="true" /> Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.connectButton}
                  disabled={
                    !capability.available || !selectedPod || !selectedContainer
                  }
                  onClick={connectTerminal}
                >
                  <Play aria-hidden="true" /> Connect
                </button>
              )}
            </div>
          </header>
          <div className={styles.terminalFrame} ref={terminalElementRef} />
          <footer className={styles.terminalFooter}>
            <span>
              <span className={styles.liveDot} /> {terminalState}
            </span>
            <span>30 minute idle limit</span>
            <span>Session output is not recorded</span>
          </footer>
        </article>

        <article className={styles.forwardCard}>
          <div className={styles.forwardHeading}>
            <span className={styles.forwardIcon}>
              <Cable aria-hidden="true" />
            </span>
            <div>
              <h3>Forward a pod port</h3>
              <p>Open a temporary TCP listener on this appliance.</p>
            </div>
          </div>
          <div className={styles.forwardForm}>
            <label>
              <span>Pod port</span>
              <input
                value={remotePort}
                list="declared-container-ports"
                inputMode="numeric"
                placeholder="Required"
                onChange={(event) => setRemotePort(event.target.value)}
              />
              <datalist id="declared-container-ports">
                {declaredPorts.map((port) => (
                  <option
                    key={`${port.containerPort}-${port.name || "port"}`}
                    value={port.containerPort}
                  >
                    {port.name || `TCP ${port.containerPort}`}
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              <span>Appliance port</span>
              <input
                value={localPort}
                inputMode="numeric"
                placeholder="Random high port"
                onChange={(event) => setLocalPort(event.target.value)}
              />
            </label>
            <label>
              <span>Lifetime</span>
              <select
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
              >
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="240">4 hours</option>
                <option value="480">8 hours</option>
              </select>
            </label>
            <button
              type="button"
              className={styles.forwardButton}
              disabled={
                forwardBusy ||
                !capability.available ||
                !selectedPod ||
                !selectedContainer ||
                !remotePort
              }
              onClick={createForward}
            >
              <Cable aria-hidden="true" />
              {forwardBusy ? "Opening…" : "Open forward"}
            </button>
          </div>
          <div className={styles.exposureWarning}>
            <ShieldAlert aria-hidden="true" />
            <p>
              Anyone who can reach the appliance LAN can connect while this
              listener is active. The forwarded port does not use your
              management login.
            </p>
          </div>
          {forwardError ? (
            <div className={styles.inlineError} role="alert">
              {forwardError}
            </div>
          ) : null}
        </article>
      </div>

      <article className={styles.activeForwards}>
        <div className={styles.activeForwardsHeader}>
          <div>
            <div className={styles.eyebrow}>LAN listeners</div>
            <h3>Active forwards</h3>
          </div>
          <span className={styles.forwardCount}>{forwards.length} / 16</span>
        </div>
        {forwards.length === 0 ? (
          <div className={styles.accessEmpty}>
            <Cable aria-hidden="true" />
            <div>
              <strong>No pod ports are exposed</strong>
              <p>New forwards appear here until they stop or expire.</p>
            </div>
          </div>
        ) : (
          <div className={styles.forwardList}>
            {forwards.map((forward) => (
              <div className={styles.forwardRow} key={forward.id}>
                <div className={styles.forwardAddress}>
                  <span className={styles.liveDot} />
                  <code>{forward.address}</code>
                  <button
                    type="button"
                    aria-label={`Copy ${forward.address}`}
                    onClick={() => copyText(forward.address)}
                  >
                    <Copy aria-hidden="true" />
                  </button>
                </div>
                <div className={styles.forwardTarget}>
                  <strong>
                    {forward.namespace}/{forward.pod}
                  </strong>
                  <span>
                    {forward.container} · pod :{forward.remotePort}
                  </span>
                </div>
                <div className={styles.forwardExpiry}>
                  <Clock3 aria-hidden="true" />
                  <span>
                    {remainingLabel(forward.expiresAt)} left
                    <small>{forward.activeConnections} connections</small>
                  </span>
                </div>
                <div className={styles.forwardRowActions}>
                  <button
                    type="button"
                    onClick={() => mutateForward(forward, "extend")}
                  >
                    <Clock3 aria-hidden="true" /> Extend
                  </button>
                  <button
                    type="button"
                    className={styles.stopForwardButton}
                    onClick={() => mutateForward(forward, "stop")}
                  >
                    <X aria-hidden="true" /> Stop
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
