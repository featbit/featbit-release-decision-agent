"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResizablePanelsProps {
  left: ReactNode;
  right: ReactNode;
  /** Initial width of the left panel in pixels (default 600) */
  defaultLeftWidth?: number;
  /** Minimum width for each panel in pixels */
  minWidth?: number;
  /** Controlled right-panel collapse state (optional) */
  rightCollapsed?: boolean;
  onRightCollapsedChange?: (collapsed: boolean) => void;
}

export function ResizablePanels({
  left,
  right,
  defaultLeftWidth = 600,
  minWidth = 280,
  rightCollapsed: rightCollapsedProp,
  onRightCollapsedChange,
}: ResizablePanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [_rightCollapsed, _setRightCollapsed] = useState(false);

  // Support controlled or uncontrolled right-panel collapse
  const rightCollapsed = rightCollapsedProp ?? _rightCollapsed;
  function setRightCollapsed(value: boolean) {
    if (onRightCollapsedChange) {
      onRightCollapsedChange(value);
    } else {
      _setRightCollapsed(value);
    }
  }

  // Store width before collapse so we can restore it
  const savedLeftWidth = useRef(defaultLeftWidth);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (leftCollapsed || rightCollapsed) return;
      e.preventDefault();
      setIsDragging(true);
    },
    [leftCollapsed, rightCollapsed]
  );

  useEffect(() => {
    if (!isDragging) return;

    function onMouseMove(e: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newWidth = Math.max(
        minWidth,
        Math.min(e.clientX - rect.left, rect.width - minWidth)
      );
      setLeftWidth(newWidth);
      savedLeftWidth.current = newWidth;
    }

    function onMouseUp() {
      setIsDragging(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, minWidth]);

  function toggleLeft() {
    if (leftCollapsed) {
      setLeftWidth(savedLeftWidth.current);
    }
    setLeftCollapsed((v) => !v);
  }

  function toggleRight() {
    setRightCollapsed(!rightCollapsed);
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-1 min-h-0 relative",
        isDragging && "select-none"
      )}
    >
      {/* ── Left panel ── */}
      {!leftCollapsed ? (
        <div
          className={cn(
            "flex flex-col min-h-0 overflow-hidden",
            rightCollapsed ? "flex-1" : "shrink-0"
          )}
          style={rightCollapsed ? undefined : { width: leftWidth }}
        >
          {left}
        </div>
      ) : (
        <div className="shrink-0 flex items-start pt-2 px-1 border-r">
          <button
            onClick={toggleLeft}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
            title="Show stages"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </div>
      )}

      {/* ── Drag handle ── */}
      {!leftCollapsed && !rightCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            "shrink-0 w-1 cursor-col-resize relative group border-l border-r border-border",
            "hover:bg-primary/30 active:bg-primary/40 transition-colors",
            isDragging ? "bg-primary/40" : "bg-muted"
          )}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}

      {/* ── Right panel ── */}
      {!rightCollapsed ? (
        <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
          {right}
        </div>
      ) : (
        <div className="shrink-0 flex items-start pt-2 px-1 border-l">
          <button
            onClick={toggleRight}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
            title="Show chat"
          >
            <PanelRightOpen className="size-4" />
          </button>
        </div>
      )}

      {/* ── Collapse controls — shown on panel edges ── */}
      {!leftCollapsed && !rightCollapsed && (
        <>
          {/* Collapse left — top of drag handle area */}
          <button
            onClick={toggleLeft}
            className="absolute top-2 p-1 rounded hover:bg-muted text-muted-foreground cursor-pointer z-10"
            style={{ left: leftWidth - 24 }}
            title="Collapse stages"
          >
            <PanelLeftClose className="size-3.5" />
          </button>
          {/* Collapse right — top of right panel */}
          <button
            onClick={toggleRight}
            className="absolute top-2 p-1 rounded hover:bg-muted text-muted-foreground cursor-pointer z-10"
            style={{ left: leftWidth + 8 }}
            title="Collapse chat"
          >
            <PanelRightClose className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
