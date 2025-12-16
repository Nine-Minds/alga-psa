"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DropZone, LayoutNode, LeafContent } from "./types";
import {
  loadLayoutFromStorage,
  loadLayoutModeFromStorage,
  makeDefaultLayout,
  removeLeaf,
  saveLayoutModeToStorage,
  saveLayoutToStorage,
  splitLeaf,
  swapLeafContents,
} from "./layoutState";

const MENU_ITEM_MIME = "application/x-alga-menu-item";
const LEAF_MIME = "application/x-alga-split-leaf";

type MenuItemPayload = { href: string; title: string };

function parseMenuItemPayload(dataTransfer: DataTransfer): MenuItemPayload | null {
  try {
    const raw = dataTransfer.getData(MENU_ITEM_MIME);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<MenuItemPayload>;
    if (!parsed.href || !parsed.title) {
      return null;
    }
    return { href: parsed.href, title: parsed.title };
  } catch {
    return null;
  }
}

function getDropZone(e: React.DragEvent, bounds: DOMRect): DropZone {
  const x = e.clientX - bounds.left;
  const y = e.clientY - bounds.top;
  const xNorm = x / bounds.width - 0.5;
  const yNorm = y / bounds.height - 0.5;
  if (Math.abs(xNorm) > Math.abs(yNorm)) {
    return xNorm < 0 ? "left" : "right";
  }
  return yNorm < 0 ? "top" : "bottom";
}

function withEmbeddedParam(href: string) {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}embedded=1`;
}

function Highlight({ zone }: { zone: DropZone | null }) {
  if (!zone) {
    return null;
  }

  const common = "absolute bg-sky-300/30 border border-sky-400 pointer-events-none";
  if (zone === "left") {
    return <div className={`${common} left-0 top-0 bottom-0 w-1/2`} />;
  }
  if (zone === "right") {
    return <div className={`${common} right-0 top-0 bottom-0 w-1/2`} />;
  }
  if (zone === "top") {
    return <div className={`${common} left-0 top-0 right-0 h-1/2`} />;
  }
  return <div className={`${common} left-0 bottom-0 right-0 h-1/2`} />;
}

function SwapHighlight() {
  return <div className="absolute inset-0 bg-sky-300/20 border border-sky-400 pointer-events-none" />;
}

function LeafPane({
  leafId,
  content,
  layoutMode,
  inlineContent,
  onSplitDrop,
  onSwapDrop,
  onClose,
}: {
  leafId: string;
  content: LeafContent;
  layoutMode: boolean;
  inlineContent: React.ReactNode;
  onSplitDrop: (leafId: string, zone: DropZone, menu: MenuItemPayload) => void;
  onSwapDrop: (fromLeafId: string, toLeafId: string) => void;
  onClose: (leafId: string) => void;
}) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [zone, setZone] = useState<DropZone | null>(null);
  const [swapTarget, setSwapTarget] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [globalDragActive, setGlobalDragActive] = useState(false);

  useEffect(() => {
    const handleDragStart = () => setGlobalDragActive(true);
    const handleDragEnd = () => {
      setGlobalDragActive(false);
      setIsDraggingOver(false);
      setZone(null);
      setSwapTarget(false);
    };
    document.addEventListener("dragstart", handleDragStart, true);
    document.addEventListener("dragend", handleDragEnd, true);
    document.addEventListener("drop", handleDragEnd, true);
    return () => {
      document.removeEventListener("dragstart", handleDragStart, true);
      document.removeEventListener("dragend", handleDragEnd, true);
      document.removeEventListener("drop", handleDragEnd, true);
    };
  }, []);

  const title = content.kind === "inline" ? "Current View" : content.title;
  const canClose = layoutMode && content.kind === "iframe";

  const onDragStartLeaf = (e: React.DragEvent) => {
    if (!layoutMode) {
      return;
    }
    e.dataTransfer.setData(LEAF_MIME, leafId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!overlayRef.current) {
      return;
    }

    const isMenuItem = e.dataTransfer.types.includes(MENU_ITEM_MIME);
    const isLeaf = e.dataTransfer.types.includes(LEAF_MIME);
    if (!isMenuItem && !(layoutMode && isLeaf)) {
      return;
    }

    e.preventDefault();
    if (isMenuItem) {
      setSwapTarget(false);
      const bounds = overlayRef.current.getBoundingClientRect();
      setZone(getDropZone(e, bounds));
      return;
    }
    setZone(null);
    setSwapTarget(true);
  };

  const onDrop = (e: React.DragEvent) => {
    if (!overlayRef.current) {
      return;
    }
    e.preventDefault();
    setIsDraggingOver(false);
    setSwapTarget(false);

    const menu = parseMenuItemPayload(e.dataTransfer);
    if (menu) {
      const bounds = overlayRef.current.getBoundingClientRect();
      const dropZone = getDropZone(e, bounds);
      onSplitDrop(leafId, dropZone, menu);
      setZone(null);
      return;
    }

    if (layoutMode) {
      const fromLeafId = e.dataTransfer.getData(LEAF_MIME);
      if (fromLeafId) {
        onSwapDrop(fromLeafId, leafId);
      }
    }
    setZone(null);
  };

  const paneChrome =
    "flex items-center gap-2 px-2 h-8 text-xs text-gray-700 bg-white/70 border-b border-gray-200 select-none";
  const paneBorder = layoutMode ? "ring-2 ring-sky-300/50" : "";

  return (
    <div className={`relative h-full w-full overflow-hidden bg-gray-100 ${paneBorder}`}>
      <div className={paneChrome}>
        <div
          className={`flex-1 truncate ${layoutMode ? "cursor-move" : ""}`}
          draggable={layoutMode}
          onDragStart={onDragStartLeaf}
          title={layoutMode ? "Drag to swap panes" : undefined}
        >
          {title}
        </div>
        {canClose && (
          <button
            type="button"
            className="px-2 py-1 rounded hover:bg-gray-200 text-gray-700"
            onClick={() => onClose(leafId)}
          >
            Close
          </button>
        )}
      </div>

      <div className="relative h-[calc(100%-2rem)] w-full overflow-hidden">
        {content.kind === "inline" ? (
          <div className="h-full w-full overflow-hidden">{inlineContent}</div>
        ) : (
          <iframe
            key={content.reloadKey}
            src={withEmbeddedParam(content.href)}
            className="h-full w-full border-0 bg-white"
          />
        )}

        <div
          ref={overlayRef}
          className={`absolute inset-0 ${globalDragActive ? "pointer-events-auto" : "pointer-events-none"}`}
          onDragEnter={() => setIsDraggingOver(true)}
          onDragLeave={() => {
            setIsDraggingOver(false);
            setZone(null);
            setSwapTarget(false);
          }}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {isDraggingOver && (swapTarget ? <SwapHighlight /> : <Highlight zone={zone} />)}
        </div>
      </div>
    </div>
  );
}

function SplitNodeView({
  node,
  layoutMode,
  inlineContent,
  onSplitDrop,
  onSwapDrop,
  onClose,
}: {
  node: LayoutNode;
  layoutMode: boolean;
  inlineContent: React.ReactNode;
  onSplitDrop: (leafId: string, zone: DropZone, menu: MenuItemPayload) => void;
  onSwapDrop: (fromLeafId: string, toLeafId: string) => void;
  onClose: (leafId: string) => void;
}) {
  if (node.type === "leaf") {
    return (
      <LeafPane
        leafId={node.id}
        content={node.content}
        layoutMode={layoutMode}
        inlineContent={inlineContent}
        onSplitDrop={onSplitDrop}
        onSwapDrop={onSwapDrop}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="h-full w-full flex" style={{ flexDirection: node.direction }}>
      <div className="h-full w-full overflow-hidden" style={{ flex: node.ratio, minWidth: 0, minHeight: 0 }}>
        <SplitNodeView
          node={node.first}
          layoutMode={layoutMode}
          inlineContent={inlineContent}
          onSplitDrop={onSplitDrop}
          onSwapDrop={onSwapDrop}
          onClose={onClose}
        />
      </div>
      <div className="h-full w-full overflow-hidden" style={{ flex: 1 - node.ratio, minWidth: 0, minHeight: 0 }}>
        <SplitNodeView
          node={node.second}
          layoutMode={layoutMode}
          inlineContent={inlineContent}
          onSplitDrop={onSplitDrop}
          onSwapDrop={onSwapDrop}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

export function SplitLayoutHost({ inlineContent }: { inlineContent: React.ReactNode }) {
  const [layout, setLayout] = useState<LayoutNode>(() => makeDefaultLayout());
  const [layoutMode, setLayoutMode] = useState(false);

  useEffect(() => {
    setLayout(loadLayoutFromStorage());
    setLayoutMode(loadLayoutModeFromStorage());
  }, []);

  useEffect(() => {
    saveLayoutToStorage(layout);
  }, [layout]);

  useEffect(() => {
    saveLayoutModeToStorage(layoutMode);
  }, [layoutMode]);

  const onSplitDrop = (leafId: string, zone: DropZone, menu: MenuItemPayload) => {
    const newContent: LeafContent = {
      kind: "iframe",
      href: menu.href,
      title: menu.title,
      reloadKey: Date.now(),
    };
    setLayout((prev) => splitLeaf(prev, leafId, zone, newContent));
  };

  const onSwapDrop = (fromLeafId: string, toLeafId: string) => {
    setLayout((prev) => swapLeafContents(prev, fromLeafId, toLeafId));
  };

  const onClose = (leafId: string) => {
    setLayout((prev) => removeLeaf(prev, leafId));
  };

  const reset = () => setLayout(makeDefaultLayout());

  const toolbar = useMemo(() => {
    return (
      <div className="absolute right-3 top-3 z-50 flex items-center gap-2">
        <div className="hidden md:block text-xs text-gray-600 bg-white/80 border border-gray-200 rounded px-2 py-1">
          Drag sidebar items onto a pane to split
        </div>
        <button
          type="button"
          className={`px-3 py-1 rounded border text-sm ${
            layoutMode ? "bg-sky-600 text-white border-sky-700" : "bg-white text-gray-700 border-gray-300"
          }`}
          onClick={() => setLayoutMode((v) => !v)}
          title="Toggle layout mode (close/swap panes)"
        >
          Layout Mode
        </button>
        <button
          type="button"
          className="px-3 py-1 rounded border text-sm bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          onClick={reset}
          title="Reset to a single pane"
        >
          Reset
        </button>
      </div>
    );
  }, [layoutMode]);

  return (
    <div className="relative flex-1 overflow-hidden">
      {toolbar}
      <SplitNodeView
        node={layout}
        layoutMode={layoutMode}
        inlineContent={inlineContent}
        onSplitDrop={onSplitDrop}
        onSwapDrop={onSwapDrop}
        onClose={onClose}
      />
    </div>
  );
}
