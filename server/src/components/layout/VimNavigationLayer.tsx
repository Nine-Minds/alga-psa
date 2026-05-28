"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCatalogShortcut } from "@alga-psa/ui/keyboard-shortcuts";

interface VimNavigationLayerProps {
  onOpenHelp: () => void;
}

interface LinkHint {
  label: string;
  top: number;
  left: number;
}

type MacroAwaitMode = "record" | "play" | null;

// Hint label alphabet — excludes "f" because it is the trigger key for opening
// hints. If "f" were a valid label, pressing f to dismiss hints would activate
// a hint instead.
const HINT_ALPHABET = "asdghjklqwertyuiopzxcvbnm";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.closest("[hidden], [aria-hidden='true']")) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findScrollableAncestor(element: Element | null): HTMLElement | null {
  let current = element?.parentElement ?? null;

  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const canScroll = /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`);
    if (canScroll && current.scrollHeight > current.clientHeight + 8) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function getLargestScrollableElement(): HTMLElement {
  const root = document.scrollingElement as HTMLElement | null;
  let best = root ?? document.documentElement;
  let bestArea = 0;

  const candidates = Array.from(document.body.querySelectorAll<HTMLElement>("main, [class*='overflow'], [data-radix-scroll-area-viewport]"));
  for (const candidate of candidates) {
    if (!isVisibleElement(candidate)) {
      continue;
    }

    const style = window.getComputedStyle(candidate);
    const canScroll = /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`);
    if (!canScroll || candidate.scrollHeight <= candidate.clientHeight + 8) {
      continue;
    }

    const rect = candidate.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  }

  return best;
}

function getScrollTarget(): HTMLElement {
  const activeAncestor = findScrollableAncestor(document.activeElement);
  return activeAncestor ?? getLargestScrollableElement();
}

function scrollByPages(pages: number): void {
  const target = getScrollTarget();
  const amount = (target === document.documentElement || target === document.body ? window.innerHeight : target.clientHeight) * pages;
  target.scrollBy({ top: amount, behavior: "smooth" });
}

function scrollToEdge(edge: "top" | "bottom"): void {
  const target = getScrollTarget();
  target.scrollTo({ top: edge === "top" ? 0 : target.scrollHeight, behavior: "smooth" });
}

function focusInput(input: HTMLElement): void {
  input.focus();
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    input.select();
  }
}

function findSearchInput(preferSidebar: boolean): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), [contenteditable='true']",
    ),
  ).filter((candidate) => {
    if (!isVisibleElement(candidate)) {
      return false;
    }

    const searchText = [
      candidate.id,
      candidate.getAttribute("name"),
      candidate.getAttribute("placeholder"),
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("data-testid"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchText.includes("search") || candidate.getAttribute("type") === "search";
  });

  if (preferSidebar) {
    return candidates.find((candidate) => candidate.id === "app-search-input") ?? candidates[0] ?? null;
  }

  return candidates.find((candidate) => candidate.id !== "app-search-input") ?? candidates[0] ?? null;
}

function focusPrimarySearch(): void {
  const input = findSearchInput(false);
  if (input) {
    focusInput(input);
  }
}

function focusSidebarSearch(): void {
  const input = findSearchInput(true);
  if (input) {
    focusInput(input);
  }
}

function clickBackNavigation(): void {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("#back-navigation-button"));
  const target = candidates.find(isVisibleElement);
  target?.click();
}

function clearRowMarkers(): void {
  document.querySelectorAll<HTMLElement>("[data-vim-active-row='true'], [data-vim-range-row='true']").forEach((row) => {
    delete row.dataset.vimActiveRow;
    delete row.dataset.vimRangeRow;
  });
}

function getRowCheckbox(row: HTMLTableRowElement): HTMLElement | null {
  return (
    row.querySelector<HTMLInputElement>("input[type='checkbox']:not([disabled])") ??
    row.querySelector<HTMLElement>("[role='checkbox']:not([aria-disabled='true'])")
  );
}

function isCheckboxChecked(checkbox: HTMLElement): boolean {
  if (checkbox instanceof HTMLInputElement) {
    return checkbox.checked;
  }

  return checkbox.getAttribute("aria-checked") === "true";
}

function clickCheckbox(checkbox: HTMLElement): void {
  checkbox.click();
}

function selectableRowsForTable(table: HTMLTableElement | null): HTMLTableRowElement[] {
  const selector = table ? "tbody tr" : "table tbody tr";
  const root: ParentNode = table ?? document;
  return Array.from(root.querySelectorAll<HTMLTableRowElement>(selector)).filter((row) => isVisibleElement(row) && getRowCheckbox(row));
}

function markActiveRows(
  activeRow: HTMLTableRowElement | null,
  visualAnchor: HTMLTableRowElement | null,
  visualMode: boolean,
): void {
  clearRowMarkers();

  if (!activeRow) {
    return;
  }

  activeRow.dataset.vimActiveRow = "true";

  if (!visualMode || !visualAnchor) {
    return;
  }

  const table = activeRow.closest("table");
  if (visualAnchor.closest("table") !== table) {
    return;
  }

  const rows = selectableRowsForTable(table);
  const activeIndex = rows.indexOf(activeRow);
  const anchorIndex = rows.indexOf(visualAnchor);
  if (activeIndex < 0 || anchorIndex < 0) {
    return;
  }

  const start = Math.min(activeIndex, anchorIndex);
  const end = Math.max(activeIndex, anchorIndex);
  rows.slice(start, end + 1).forEach((row) => {
    row.dataset.vimRangeRow = "true";
  });
}

function getRowAction(row: HTMLTableRowElement): HTMLElement | null {
  const candidates = Array.from(row.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [role='button'], [role='link']"));
  return candidates.find((candidate) => {
    if (!isVisibleElement(candidate)) {
      return false;
    }
    if (candidate.closest("[data-vim-hint-overlay='true']")) {
      return false;
    }
    if (candidate.matches("input, textarea, select, [role='checkbox']")) {
      return false;
    }
    if (candidate.querySelector("input[type='checkbox'], [role='checkbox']")) {
      return false;
    }
    return true;
  }) ?? null;
}

// Generate labels of uniform length so a typed prefix is never ambiguous with
// a complete label. If labels mixed lengths (e.g. "a" and "at"), typing "a"
// would have an exact match AND a longer prefix, requiring a timeout to
// disambiguate — and the timeout races the user's second keystroke.
function generateHintLabels(count: number): string[] {
  if (count <= 0) return [];

  const base = HINT_ALPHABET.length;
  let length = 1;
  while (Math.pow(base, length) < count) {
    length += 1;
  }

  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    let label = "";
    let n = i;
    for (let pos = 0; pos < length; pos++) {
      label = HINT_ALPHABET[n % base] + label;
      n = Math.floor(n / base);
    }
    labels.push(label);
  }
  return labels;
}

function getHintTargets(): HTMLElement[] {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), [role='button'], [role='link'], input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled])",
    ),
  );

  return candidates.filter((candidate) => {
    if (!isVisibleElement(candidate)) {
      return false;
    }
    if (candidate.closest("[data-vim-hint-overlay='true']")) {
      return false;
    }
    if (candidate.getAttribute("aria-disabled") === "true") {
      return false;
    }

    const rect = candidate.getBoundingClientRect();
    return rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
  });
}

export default function VimNavigationLayer({ onOpenHelp }: VimNavigationLayerProps): React.JSX.Element {
  const router = useRouter();
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  const visualAnchorRef = useRef<HTMLTableRowElement | null>(null);
  const visualModeRef = useRef(false);
  const lastActionRef = useRef<string | null>(null);
  const recordingRegisterRef = useRef<string | null>(null);
  const macroAwaitModeRef = useRef<MacroAwaitMode>(null);
  const macrosRef = useRef<Record<string, string[]>>({});
  const safeActionsRef = useRef<Record<string, () => void>>({});
  const hintInputRef = useRef("");
  const hintTargetsRef = useRef<Record<string, HTMLElement>>({});
  const hintsActiveRef = useRef(false);
  const linkHintNewTabRef = useRef(false);
  const hintActivationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visualMode, setVisualMode] = useState(false);
  const [macroStatus, setMacroStatus] = useState<string | null>(null);
  const [hints, setHints] = useState<LinkHint[]>([]);

  const updateRowMarkers = useCallback(() => {
    markActiveRows(activeRowRef.current, visualAnchorRef.current, visualModeRef.current);
  }, []);

  const setActiveRow = useCallback((row: HTMLTableRowElement | null) => {
    activeRowRef.current = row;
    updateRowMarkers();
    row?.scrollIntoView({ block: "nearest" });
  }, [updateRowMarkers]);

  const getCurrentRows = useCallback(() => {
    const activeTable = activeRowRef.current?.closest("table") ?? null;
    const tableRows = selectableRowsForTable(activeTable);
    return tableRows.length > 0 ? tableRows : selectableRowsForTable(null);
  }, []);

  const moveTableRow = useCallback((direction: 1 | -1) => {
    const rows = getCurrentRows();
    if (rows.length === 0) {
      return;
    }

    const currentIndex = activeRowRef.current ? rows.indexOf(activeRowRef.current) : -1;
    const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, currentIndex + direction));
    setActiveRow(rows[nextIndex] ?? null);
  }, [getCurrentRows, setActiveRow]);

  const toggleCurrentRows = useCallback(() => {
    const activeRow = activeRowRef.current;
    if (!activeRow) {
      const firstRow = selectableRowsForTable(null)[0] ?? null;
      setActiveRow(firstRow);
      return;
    }

    if (!visualModeRef.current || !visualAnchorRef.current || visualAnchorRef.current.closest("table") !== activeRow.closest("table")) {
      const checkbox = getRowCheckbox(activeRow);
      if (checkbox) {
        clickCheckbox(checkbox);
      }
      return;
    }

    const rows = selectableRowsForTable(activeRow.closest("table"));
    const activeIndex = rows.indexOf(activeRow);
    const anchorIndex = rows.indexOf(visualAnchorRef.current);
    if (activeIndex < 0 || anchorIndex < 0) {
      return;
    }

    const selectedRows = rows.slice(Math.min(activeIndex, anchorIndex), Math.max(activeIndex, anchorIndex) + 1);
    const checkboxes = selectedRows.map(getRowCheckbox).filter((checkbox): checkbox is HTMLElement => Boolean(checkbox));
    const shouldSelect = !checkboxes.every(isCheckboxChecked);
    checkboxes.forEach((checkbox) => {
      if (isCheckboxChecked(checkbox) !== shouldSelect) {
        clickCheckbox(checkbox);
      }
    });
  }, [setActiveRow]);

  const toggleVisualMode = useCallback(() => {
    const activeRow = activeRowRef.current ?? selectableRowsForTable(null)[0] ?? null;
    activeRowRef.current = activeRow;
    visualAnchorRef.current = activeRow;
    visualModeRef.current = !visualModeRef.current;
    setVisualMode(visualModeRef.current);
    updateRowMarkers();
  }, [updateRowMarkers]);

  const openCurrentRow = useCallback(() => {
    const activeRow = activeRowRef.current ?? selectableRowsForTable(null)[0] ?? null;
    if (!activeRow) {
      return;
    }

    activeRowRef.current = activeRow;
    updateRowMarkers();
    getRowAction(activeRow)?.click();
  }, [updateRowMarkers]);

  const closeHints = useCallback(() => {
    if (hintActivationTimerRef.current) {
      clearTimeout(hintActivationTimerRef.current);
      hintActivationTimerRef.current = null;
    }
    hintInputRef.current = "";
    hintTargetsRef.current = {};
    hintsActiveRef.current = false;
    setHints([]);
  }, []);

  const openHints = useCallback((newTab: boolean) => {
    const targets = getHintTargets();
    const labels = generateHintLabels(targets.length);
    const nextHints: LinkHint[] = [];
    const nextTargets: Record<string, HTMLElement> = {};

    targets.forEach((target, index) => {
      const label = labels[index] ?? "";
      if (!label) return;
      const rect = target.getBoundingClientRect();
      nextHints.push({ label, top: Math.max(4, rect.top), left: Math.max(4, rect.left) });
      nextTargets[label] = target;
    });

    linkHintNewTabRef.current = newTab;
    hintInputRef.current = "";
    hintTargetsRef.current = nextTargets;
    hintsActiveRef.current = nextHints.length > 0;
    setHints(nextHints);
  }, []);

  const activateHint = useCallback((label: string) => {
    const target = hintTargetsRef.current[label];
    if (!target) {
      closeHints();
      return;
    }

    if (linkHintNewTabRef.current && target instanceof HTMLAnchorElement && target.href) {
      window.open(target.href, "_blank", "noopener,noreferrer");
    } else {
      target.click();
    }

    closeHints();
  }, [closeHints]);

  const runAction = useCallback((id: string, options: { record?: boolean; setLast?: boolean } = {}) => {
    const action = safeActionsRef.current[id];
    if (!action) {
      return false;
    }

    action();

    if (options.setLast !== false) {
      lastActionRef.current = id;
    }

    const recordingRegister = recordingRegisterRef.current;
    if (options.record !== false && recordingRegister) {
      macrosRef.current[recordingRegister] = [...(macrosRef.current[recordingRegister] ?? []), id];
    }

    return undefined;
  }, []);

  const replayMacro = useCallback((register: string) => {
    const actionIds = macrosRef.current[register] ?? [];
    actionIds.forEach((id) => {
      runAction(id, { record: false });
    });
  }, [runAction]);

  useEffect(() => {
    safeActionsRef.current = {
      "scroll.halfDown": () => scrollByPages(0.5),
      "scroll.halfUp": () => scrollByPages(-0.5),
      "scroll.fullDown": () => scrollByPages(1),
      "scroll.fullUp": () => scrollByPages(-1),
      "scroll.top": () => scrollToEdge("top"),
      "scroll.bottom": () => scrollToEdge("bottom"),
      "focus.primarySearch": focusPrimarySearch,
      "table.nextRow": () => moveTableRow(1),
      "table.previousRow": () => moveTableRow(-1),
      "table.toggleRow": toggleCurrentRows,
      "table.visualRange": toggleVisualMode,
      "table.openRow": openCurrentRow,
      "linkhints.show": () => openHints(false),
      "linkhints.showNewTab": () => openHints(true),
      "navigation.goDashboard": () => router.push("/msp/dashboard"),
      "navigation.goProjects": () => router.push("/msp/projects"),
      "navigation.goBilling": () => router.push("/msp/billing?tab=client-contracts"),
      "navigation.goSettings": () => router.push("/msp/settings"),
      "navigation.goSearch": focusSidebarSearch,
      "navigation.goHelp": onOpenHelp,
      "navigation.backToParent": clickBackNavigation,
    };
  }, [moveTableRow, onOpenHelp, openCurrentRow, openHints, router, toggleCurrentRows, toggleVisualMode]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const row = event.target.closest("tr");
      if (!(row instanceof HTMLTableRowElement) || !getRowCheckbox(row)) {
        return;
      }

      activeRowRef.current = row;
      updateRowMarkers();
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      clearRowMarkers();
    };
  }, [updateRowMarkers]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (hintsActiveRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeHints();
          return;
        }

        if (event.key.length !== 1) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        const nextInput = `${hintInputRef.current}${event.key.toLowerCase()}`;
        const labels = Object.keys(hintTargetsRef.current);

        if (hintActivationTimerRef.current) {
          clearTimeout(hintActivationTimerRef.current);
          hintActivationTimerRef.current = null;
        }

        const exactMatch = hintTargetsRef.current[nextInput];
        const hasLongerPrefix = labels.some(
          (label) => label.length > nextInput.length && label.startsWith(nextInput),
        );

        if (exactMatch && !hasLongerPrefix) {
          activateHint(nextInput);
          return;
        }

        if (exactMatch && hasLongerPrefix) {
          hintInputRef.current = nextInput;
          hintActivationTimerRef.current = setTimeout(() => {
            hintActivationTimerRef.current = null;
            activateHint(nextInput);
          }, 250);
          return;
        }

        if (hasLongerPrefix) {
          hintInputRef.current = nextInput;
          return;
        }

        closeHints();
        return;
      }

      const macroAwaitMode = macroAwaitModeRef.current;
      if (!macroAwaitMode) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        macroAwaitModeRef.current = null;
        setMacroStatus(recordingRegisterRef.current ? `Recording @${recordingRegisterRef.current}` : null);
        return;
      }

      if (!/^[a-z0-9]$/i.test(event.key)) {
        return;
      }

      event.preventDefault();
      const register = event.key.toLowerCase();
      macroAwaitModeRef.current = null;

      if (macroAwaitMode === "record") {
        recordingRegisterRef.current = register;
        macrosRef.current[register] = [];
        setMacroStatus(`Recording @${register}`);
        return;
      }

      setMacroStatus(null);
      replayMacro(register);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activateHint, closeHints, replayMacro]);

  const repeatLastAction = useCallback(() => {
    const lastAction = lastActionRef.current;
    if (!lastAction) {
      return false;
    }

    return runAction(lastAction, { record: false, setLast: false });
  }, [runAction]);

  const recordMacro = useCallback(() => {
    if (recordingRegisterRef.current) {
      recordingRegisterRef.current = null;
      setMacroStatus(null);
      return undefined;
    }

    macroAwaitModeRef.current = "record";
    setMacroStatus("Record macro: press register");
    return undefined;
  }, []);

  const playMacro = useCallback(() => {
    macroAwaitModeRef.current = "play";
    setMacroStatus("Play macro: press register");
    return undefined;
  }, []);

  useCatalogShortcut("scroll.halfDown", useCallback(() => runAction("scroll.halfDown"), [runAction]));
  useCatalogShortcut("scroll.halfUp", useCallback(() => runAction("scroll.halfUp"), [runAction]));
  useCatalogShortcut("scroll.fullDown", useCallback(() => runAction("scroll.fullDown"), [runAction]));
  useCatalogShortcut("scroll.fullUp", useCallback(() => runAction("scroll.fullUp"), [runAction]));
  useCatalogShortcut("scroll.top", useCallback(() => runAction("scroll.top"), [runAction]));
  useCatalogShortcut("scroll.bottom", useCallback(() => runAction("scroll.bottom"), [runAction]));
  useCatalogShortcut("focus.primarySearch", useCallback(() => runAction("focus.primarySearch"), [runAction]));
  useCatalogShortcut("table.nextRow", useCallback(() => runAction("table.nextRow"), [runAction]));
  useCatalogShortcut("table.previousRow", useCallback(() => runAction("table.previousRow"), [runAction]));
  useCatalogShortcut("table.toggleRow", useCallback(() => runAction("table.toggleRow"), [runAction]));
  useCatalogShortcut("table.visualRange", useCallback(() => runAction("table.visualRange"), [runAction]));
  useCatalogShortcut("table.openRow", useCallback(() => runAction("table.openRow"), [runAction]));
  useCatalogShortcut("repeat.lastAction", repeatLastAction);
  useCatalogShortcut("linkhints.show", useCallback(() => runAction("linkhints.show"), [runAction]));
  useCatalogShortcut("linkhints.showNewTab", useCallback(() => runAction("linkhints.showNewTab"), [runAction]));
  useCatalogShortcut("macro.record", recordMacro);
  useCatalogShortcut("macro.play", playMacro);
  useCatalogShortcut("navigation.goDashboard", useCallback(() => runAction("navigation.goDashboard"), [runAction]));
  useCatalogShortcut("navigation.goProjects", useCallback(() => runAction("navigation.goProjects"), [runAction]));
  useCatalogShortcut("navigation.goBilling", useCallback(() => runAction("navigation.goBilling"), [runAction]));
  useCatalogShortcut("navigation.goSettings", useCallback(() => runAction("navigation.goSettings"), [runAction]));
  useCatalogShortcut("navigation.goSearch", useCallback(() => runAction("navigation.goSearch"), [runAction]));
  useCatalogShortcut("navigation.goHelp", useCallback(() => runAction("navigation.goHelp"), [runAction]));
  useCatalogShortcut("navigation.backToParent", useCallback(() => runAction("navigation.backToParent"), [runAction]));

  return (
    <>
      <style>{`
        tr[data-vim-active-row="true"] {
          background-color: rgb(var(--color-table-selected));
        }
        tr[data-vim-range-row="true"] {
          background-color: rgb(var(--color-table-hover));
        }
      `}</style>
      {hints.length > 0 ? (
        <div data-vim-hint-overlay="true" className="pointer-events-none fixed inset-0 z-[9999]">
          {hints.map((hint) => (
            <span
              key={hint.label}
              className="absolute rounded bg-yellow-300 px-1 py-0.5 font-mono text-xs font-bold text-gray-950 shadow"
              style={{ top: hint.top, left: hint.left }}
            >
              {hint.label}
            </span>
          ))}
        </div>
      ) : null}
      {macroStatus || visualMode ? (
        <div className="fixed bottom-3 right-3 z-[9999] rounded bg-gray-950 px-3 py-2 text-xs font-medium text-white shadow-lg">
          {macroStatus ?? "Visual row range"}
        </div>
      ) : null}
    </>
  );
}
