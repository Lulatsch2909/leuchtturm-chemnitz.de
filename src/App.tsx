import { useState, useCallback, useEffect, useRef } from "react";
import { Undo2, Redo2, Trash2, Eraser, Save, Maximize2, Minimize2 } from "lucide-react";

const buildingImg = "/kongress-hotel-nacht.png";

const ROWS = 26;
const COLS = 9;

type ColumnAnchors = { topX: number; topY: number; bottomX: number; bottomY: number };

function makeDefaultColumns(): ColumnAnchors[] {
  return [
    { topX: 31.8, topY: 16.2, bottomX: 32.1, bottomY: 77.7 },
    { topX: 37.1, topY: 17.8, bottomX: 37.7, bottomY: 77.6 },
    { topX: 42.1, topY: 18.9, bottomX: 42.7, bottomY: 77.2 },
    { topX: 47.3, topY: 20.5, bottomX: 47.9, bottomY: 77.0 },
    { topX: 52.0, topY: 21.3, bottomX: 52.5, bottomY: 76.9 },
    { topX: 56.6, topY: 22.4, bottomX: 57.2, bottomY: 76.6 },
    { topX: 60.9, topY: 23.6, bottomX: 61.4, bottomY: 76.5 },
    { topX: 64.8, topY: 25.0, bottomX: 65.2, bottomY: 76.2 },
    { topX: 68.4, topY: 25.6, bottomX: 68.9, bottomY: 76.4 },
  ];
}

function getWindowPos(row: number, col: number, columns: ColumnAnchors[]) {
  const c = columns[col];
  const v = row / (ROWS - 1);
  return {
    x: c.topX + v * (c.bottomX - c.topX),
    y: c.topY + v * (c.bottomY - c.topY),
  };
}

function getWindowSize(col: number, columns: ColumnAnchors[]) {
  let w: number;
  if (col === 0) {
    const next = columns[1];
    const cur = columns[0];
    w = Math.abs(next.topX - cur.topX) * 0.75;
  } else if (col === COLS - 1) {
    const prev = columns[COLS - 2];
    const cur = columns[COLS - 1];
    w = Math.abs(cur.topX - prev.topX) * 0.75;
  } else {
    const prev = columns[col - 1];
    const next = columns[col + 1];
    w = (Math.abs(next.topX - prev.topX) / 2) * 0.75;
  }
  const c = columns[col];
  const h = (Math.abs(c.bottomY - c.topY) / ROWS) * 0.72;
  return { w, h };
}

function getWindowHitSize(col: number, columns: ColumnAnchors[]) {
  let w: number;
  if (col === 0) {
    const next = columns[1];
    const cur = columns[0];
    w = Math.abs(next.topX - cur.topX);
  } else if (col === COLS - 1) {
    const prev = columns[COLS - 2];
    const cur = columns[COLS - 1];
    w = Math.abs(cur.topX - prev.topX);
  } else {
    const prev = columns[col - 1];
    const next = columns[col + 1];
    w = Math.abs(next.topX - prev.topX) / 2;
  }
  const c = columns[col];
  const h = Math.abs(c.bottomY - c.topY) / ROWS;
  return { w, h };
}

type Selection = { startRow: number; startCol: number; endRow: number; endCol: number } | null;
type SavedPattern = { id: number; windows: boolean[][] };
type SavedPatternMenu = { patternId: number; x: number; y: number } | null;

function normalizeSelection(sel: NonNullable<Selection>) {
  return {
    r1: Math.min(sel.startRow, sel.endRow),
    r2: Math.max(sel.startRow, sel.endRow),
    c1: Math.min(sel.startCol, sel.endCol),
    c2: Math.max(sel.startCol, sel.endCol),
  };
}

type DraggingAnchor = { col: number; end: "top" | "bottom" } | null;

const App = () => {
  const [columns, setColumns] = useState<ColumnAnchors[]>(makeDefaultColumns);
  const [windows, setWindows] = useState<boolean[][]>(() =>
    Array.from({ length: ROWS }, () => Array(COLS).fill(false))
  );
  const [history, setHistory] = useState<{ prev: boolean[][]; next: boolean[][] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selection, setSelection] = useState<Selection>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [draggingAnchor, setDraggingAnchor] = useState<DraggingAnchor>(null);
  const [showGrid] = useState(() =>
    new URLSearchParams(window.location.search).has("config")
  );
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 900);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [savedPatterns, setSavedPatterns] = useState<SavedPattern[]>([]);
  const [nextPatternId, setNextPatternId] = useState(1);
  const [savedPatternMenu, setSavedPatternMenu] = useState<SavedPatternMenu>(null);
  const [isMobileFocusMode, setIsMobileFocusMode] = useState(() => window.innerWidth <= 900);
  const [isMobileSavedDrawerOpen, setIsMobileSavedDrawerOpen] = useState(false);
  const imageRef = useRef<HTMLDivElement>(null);
  const paintStartWindows = useRef<boolean[][] | null>(null);
  const paintStartCell = useRef<{ row: number; col: number } | null>(null);
  const paintStartedFromLit = useRef(false);
  const paintMoved = useRef(false);
  const pendingClickToggleTimeout = useRef<number | null>(null);
  const longPressTimeoutRef = useRef<number | null>(null);
  const longPressTriggeredPatternRef = useRef<number | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeEdgeRef = useRef<"left" | "top" | null>(null);

  const pushHistory = useCallback(
    (prev: boolean[][], next: boolean[][]) => {
      setHistory((h) => {
        const newH = h.slice(0, historyIndex + 1);
        newH.push({ prev: prev.map((r) => [...r]), next: next.map((r) => [...r]) });
        return newH;
      });
      setHistoryIndex((i) => i + 1);
    },
    [historyIndex]
  );

  const clearPendingClickToggle = useCallback(() => {
    if (pendingClickToggleTimeout.current !== null) {
      window.clearTimeout(pendingClickToggleTimeout.current);
      pendingClickToggleTimeout.current = null;
    }
  }, []);

  const clearLongPressTimeout = useCallback(() => {
    if (longPressTimeoutRef.current !== null) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  const handleLeftDown = useCallback(
    (row: number, col: number) => {
      if (draggingAnchor || showGrid) return;
      setSelection(null);
      paintStartWindows.current = windows.map((r) => [...r]);
      paintStartCell.current = { row, col };
      paintStartedFromLit.current = windows[row][col];
      paintMoved.current = false;
      setIsPainting(true);
    },
    [draggingAnchor, isEraserMode, showGrid, windows]
  );

  const handleLeftEnter = useCallback(
    (row: number, col: number) => {
      if (!isPainting) return;
      if (
        paintStartCell.current &&
        (paintStartCell.current.row !== row || paintStartCell.current.col !== col)
      ) {
        paintMoved.current = true;
      }
      setWindows((prev) => {
        const next = prev.map((r) => [...r]);
        if (paintStartCell.current && paintMoved.current) {
          next[paintStartCell.current.row][paintStartCell.current.col] = isEraserMode ? false : true;
        }
        next[row][col] = isEraserMode ? false : true;
        return next;
      });
    },
    [isEraserMode, isPainting]
  );

  const handleLeftUp = useCallback(() => {
    if (isPainting && paintStartWindows.current) {
      const next = windows.map((r) => [...r]);
      if (paintStartCell.current && !paintMoved.current) {
        const sr = paintStartCell.current.row;
        const sc = paintStartCell.current.col;
        if (isEraserMode) {
          next[sr][sc] = false;
        } else if (!paintStartedFromLit.current) {
          // Single click on dark window should light it.
          next[sr][sc] = true;
        }
      }
      if (
        !isEraserMode &&
        paintStartedFromLit.current &&
        !paintMoved.current &&
        paintStartCell.current
      ) {
        clearPendingClickToggle();
        const sr = paintStartCell.current.row;
        const sc = paintStartCell.current.col;
        pendingClickToggleTimeout.current = window.setTimeout(() => {
          setWindows((cur) => {
            const delayed = cur.map((r) => [...r]);
            delayed[sr][sc] = false;
            return delayed;
          });
          pendingClickToggleTimeout.current = null;
        }, 220);
      }
      pushHistory(paintStartWindows.current, next);
      setWindows(next);
      paintStartWindows.current = null;
      paintStartCell.current = null;
      paintStartedFromLit.current = false;
      paintMoved.current = false;
    }
    setIsPainting(false);
  }, [clearPendingClickToggle, isPainting, isEraserMode, windows, pushHistory]);

  const handleSelectionStart = useCallback(
    (row: number, col: number) => {
      if (draggingAnchor || showGrid) return;
      clearPendingClickToggle();
      setIsSelecting(true);
      setSelection({ startRow: row, startCol: col, endRow: row, endCol: col });
    },
    [clearPendingClickToggle, draggingAnchor, showGrid]
  );

  const handleSelectionEnter = useCallback(
    (row: number, col: number) => {
      if (!isSelecting) return;
      setSelection((prev) => (prev ? { ...prev, endRow: row, endCol: col } : null));
    },
    [isSelecting]
  );

  const handleSelectionUp = useCallback(() => {
    setIsSelecting(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleAnchorMouseDown = useCallback((col: number, end: "top" | "bottom", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingAnchor({ col, end });
  }, []);

  useEffect(() => {
    if (!draggingAnchor) return;
    const handleMove = (e: MouseEvent) => {
      if (!imageRef.current) return;
      const rect = imageRef.current.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
      const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
      const cx = Math.max(0, Math.min(100, x));
      const cy = Math.max(0, Math.min(100, y));
      setColumns((prev) => {
        const next = [...prev];
        const c = { ...next[draggingAnchor.col] };
        if (draggingAnchor.end === "top") {
          c.topX = cx;
          c.topY = cy;
        } else {
          c.bottomX = cx;
          c.bottomY = cy;
        }
        next[draggingAnchor.col] = c;
        return next;
      });
    };
    const handleUp = () => setDraggingAnchor(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingAnchor]);

  useEffect(() => {
    const handler = () => {
      setIsPainting(false);
      setIsSelecting(false);
    };
    window.addEventListener("mouseup", handler);
    window.addEventListener("pointerup", handler);
    window.addEventListener("pointercancel", handler);
    return () => {
      window.removeEventListener("mouseup", handler);
      window.removeEventListener("pointerup", handler);
      window.removeEventListener("pointercancel", handler);
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isPainting && !isSelecting) return;
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLButtonElement>("[data-cell='1']");
      if (!target) return;
      const rowAttr = target.getAttribute("data-row");
      const colAttr = target.getAttribute("data-col");
      if (rowAttr === null || colAttr === null) return;
      const row = Number(rowAttr);
      const col = Number(colAttr);
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      handleLeftEnter(row, col);
      handleSelectionEnter(row, col);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [handleLeftEnter, handleSelectionEnter, isPainting, isSelecting]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsMobileFocusMode(false);
      setIsMobileSavedDrawerOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsMobileFocusMode(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const undo = useCallback(() => {
    if (historyIndex < 0) return;
    setWindows(history[historyIndex].prev.map((r) => [...r]));
    setHistoryIndex((i) => i - 1);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    setWindows(history[historyIndex + 1].next.map((r) => [...r]));
    setHistoryIndex((i) => i + 1);
  }, [history, historyIndex]);

  const resetAll = useCallback(() => {
    const prev = windows.map((r) => [...r]);
    const next = Array.from({ length: ROWS }, () => Array(COLS).fill(false)) as boolean[][];
    pushHistory(prev, next);
    setWindows(next);
    setSelection(null);
  }, [windows, pushHistory]);

  const loadSavedPattern = useCallback(
    (pattern: boolean[][]) => {
      const prev = windows.map((r) => [...r]);
      const next = pattern.map((r) => [...r]);
      pushHistory(prev, next);
      setWindows(next);
      setSelection(null);
    },
    [pushHistory, windows]
  );

  const saveCurrentPattern = useCallback(() => {
    const snapshot = windows.map((r) => [...r]);
    setSavedPatterns((prev) => [{ id: nextPatternId, windows: snapshot }, ...prev]);
    setNextPatternId((id) => id + 1);
    const empty = Array.from({ length: ROWS }, () => Array(COLS).fill(false)) as boolean[][];
    pushHistory(snapshot, empty);
    setWindows(empty);
    setSelection(null);
  }, [nextPatternId, pushHistory, windows]);

  const deleteSavedPattern = useCallback((patternId: number) => {
    setSavedPatterns((prev) => prev.filter((pattern) => pattern.id !== patternId));
    setSavedPatternMenu(null);
  }, []);

  useEffect(() => {
    const closeMenu = () => setSavedPatternMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
    };
  }, []);

  useEffect(
    () => () => {
      clearPendingClickToggle();
      clearLongPressTimeout();
    },
    [clearLongPressTimeout, clearPendingClickToggle]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const isInSelection = (row: number, col: number) => {
    if (!selection) return false;
    const { r1, r2, c1, c2 } = normalizeSelection(selection);
    return row >= r1 && row <= r2 && col >= c1 && col <= c2;
  };

  const litCount = windows.flat().filter(Boolean).length;
  const hasSelection = selection && (selection.startRow !== selection.endRow || selection.startCol !== selection.endCol);
  const showDesktopSavedList = !isMobile || !isMobileFocusMode;
  const showMobileSavedDrawer = isMobile && isMobileFocusMode;
  const controlSize = isMobileFocusMode && isMobile ? 34 : 40;
  const exportAnchors = useCallback(() => {
    const text = JSON.stringify(columns, null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      return;
    }
    // Fallback for restricted browser contexts.
    window.prompt("Ankerpunkte kopieren:", text);
  }, [columns]);

  const handleFocusTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!showMobileSavedDrawer) return;
      const touch = e.touches[0];
      if (!touch) return;
      if (touch.clientY <= 26) {
        swipeStartYRef.current = touch.clientY;
        swipeEdgeRef.current = "top";
      } else if (touch.clientX <= 24 || isMobileSavedDrawerOpen) {
        swipeStartXRef.current = touch.clientX;
        swipeEdgeRef.current = "left";
      } else {
        swipeStartXRef.current = null;
        swipeStartYRef.current = null;
        swipeEdgeRef.current = null;
      }
    },
    [isMobileSavedDrawerOpen, showMobileSavedDrawer]
  );

  const handleFocusTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!showMobileSavedDrawer || swipeEdgeRef.current === null) return;
      const touch = e.touches[0];
      if (!touch) return;
      const deltaX = swipeStartXRef.current === null ? 0 : touch.clientX - swipeStartXRef.current;
      const deltaY = swipeStartYRef.current === null ? 0 : touch.clientY - swipeStartYRef.current;
      if (swipeEdgeRef.current === "left") {
        if (!isMobileSavedDrawerOpen && deltaX > 48) {
          setIsMobileSavedDrawerOpen(true);
          swipeStartXRef.current = null;
        }
        if (isMobileSavedDrawerOpen && deltaX < -48) {
          setIsMobileSavedDrawerOpen(false);
          swipeStartXRef.current = null;
        }
      }
      if (swipeEdgeRef.current === "top" && deltaY > 90) {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        }
        setIsMobileFocusMode(false);
        setIsMobileSavedDrawerOpen(false);
        swipeStartYRef.current = null;
        swipeEdgeRef.current = null;
      }
    },
    [isMobileSavedDrawerOpen, showMobileSavedDrawer]
  );

  const handleFocusTouchEnd = useCallback(() => {
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    swipeEdgeRef.current = null;
  }, []);

  const toggleFullscreenMode = useCallback(async () => {
    const root = document.documentElement;
    if (document.fullscreenElement || isMobileFocusMode) {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      setIsMobileFocusMode(false);
      setIsMobileSavedDrawerOpen(false);
      return;
    }
    setIsMobileFocusMode(true);
    setIsMobileSavedDrawerOpen(false);
    if (root.requestFullscreen) {
      try {
        await root.requestFullscreen();
      } catch {
        // Keep fallback focus mode when fullscreen API is blocked.
      }
    }
  }, [isMobileFocusMode]);

  const savedPatternsPanel = (
    <div
      className="saved-patterns-scroll"
      style={{
        width: isMobile ? "100%" : 150,
        maxHeight: isMobile ? "calc(100vh - 120px)" : "min(82vh, 750px)",
        overflowY: isMobile ? "auto" : "auto",
        overflowX: isMobile ? "hidden" : "hidden",
        whiteSpace: isMobile ? "normal" : "normal",
        padding: 10,
        borderRadius: 10,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginBottom: 8 }}>Gespeichert</div>
      {savedPatterns.length === 0 && (
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>Noch keine Bilder</div>
      )}
      {savedPatterns.map((pattern) => (
        <button
          key={pattern.id}
          onClick={() => {
            if (longPressTriggeredPatternRef.current === pattern.id) {
              longPressTriggeredPatternRef.current = null;
              return;
            }
            loadSavedPattern(pattern.windows);
            if (showMobileSavedDrawer) setIsMobileSavedDrawerOpen(false);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            clearLongPressTimeout();
            setSavedPatternMenu({ patternId: pattern.id, x: e.clientX, y: e.clientY });
          }}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse") return;
            clearLongPressTimeout();
            longPressTimeoutRef.current = window.setTimeout(() => {
              longPressTriggeredPatternRef.current = pattern.id;
              if (navigator.vibrate) navigator.vibrate(25);
              setSavedPatternMenu({ patternId: pattern.id, x: e.clientX, y: e.clientY });
              longPressTimeoutRef.current = null;
            }, 550);
          }}
          onPointerUp={() => clearLongPressTimeout()}
          onPointerCancel={() => clearLongPressTimeout()}
          onPointerLeave={() => clearLongPressTimeout()}
          style={{
            width: isMobile ? "100%" : "100%",
            display: "block",
            marginBottom: 8,
            marginRight: 0,
            padding: 6,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(6,10,20,0.9)",
            cursor: "pointer",
            WebkitTouchCallout: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
          title={`Motiv ${pattern.id} laden`}
        >
          <div style={{ position: "relative", width: "100%", aspectRatio: "450 / 799", overflow: "hidden", borderRadius: 6 }}>
            <img
              src={buildingImg}
              alt=""
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "brightness(0.84) contrast(1.14) saturate(0.95)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background:
                  "radial-gradient(ellipse at 58% 12%, rgba(78,118,205,0.1) 0%, rgba(12,22,44,0.24) 50%, rgba(4,8,18,0.42) 100%)",
              }}
            />
            {pattern.windows.flatMap((row, ri) =>
              row.map((lit, ci) => {
                if (!lit) return null;
                const pos = getWindowPos(ri, ci, columns);
                const size = getWindowSize(ci, columns);
                return (
                  <div
                    key={`${pattern.id}-${ri}-${ci}`}
                    style={{
                      position: "absolute",
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      width: `${size.w}%`,
                      height: `${size.h}%`,
                      transform: "translate(-50%, -50%)",
                      background:
                        "radial-gradient(ellipse, rgba(255,235,160,0.95) 0%, rgba(255,210,80,0.7) 60%, rgba(255,180,40,0.3) 100%)",
                      boxShadow: "0 0 5px 1px rgba(255,220,100,0.45), 0 0 12px 2px rgba(255,200,60,0.2)",
                    }}
                  />
                );
              })
            )}
          </div>
        </button>
      ))}
    </div>
  );

  const controlsPanel = (
    <>
      <button
        onClick={undo}
        disabled={historyIndex < 0}
        title="Zurueck"
        aria-label="Zurueck"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: controlSize, height: controlSize, borderRadius: 8, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.85)", border: 0, cursor: historyIndex < 0 ? "not-allowed" : "pointer", opacity: historyIndex < 0 ? 0.3 : 1 }}
      >
        <Undo2 size={isMobileFocusMode && isMobile ? 16 : 18} />
      </button>
      <button
        onClick={redo}
        disabled={historyIndex >= history.length - 1}
        title="Vor"
        aria-label="Vor"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: controlSize, height: controlSize, borderRadius: 8, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.85)", border: 0, cursor: historyIndex >= history.length - 1 ? "not-allowed" : "pointer", opacity: historyIndex >= history.length - 1 ? 0.3 : 1 }}
      >
        <Redo2 size={isMobileFocusMode && isMobile ? 16 : 18} />
      </button>
      <button
        onClick={resetAll}
        title="Alle aus"
        aria-label="Alle aus"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: controlSize, height: controlSize, borderRadius: 8, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.85)", border: 0, cursor: "pointer" }}
      >
        <Trash2 size={isMobileFocusMode && isMobile ? 16 : 18} />
      </button>
      <button
        onClick={saveCurrentPattern}
        title="Motiv speichern"
        aria-label="Motiv speichern"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: controlSize, height: controlSize, borderRadius: 8, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)", border: 0, cursor: "pointer" }}
      >
        <Save size={isMobileFocusMode && isMobile ? 16 : 18} />
      </button>
      <button
        onClick={() => setIsEraserMode((v) => !v)}
        title={isEraserMode ? "Radiergummi an" : "Radiergummi aus"}
        aria-label={isEraserMode ? "Radiergummi an" : "Radiergummi aus"}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: controlSize, height: controlSize, borderRadius: 8, background: isEraserMode ? "rgba(255,120,120,0.25)" : "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)", border: 0, cursor: "pointer" }}
      >
        <Eraser size={isMobileFocusMode && isMobile ? 16 : 18} />
      </button>
      {!isMobile && (
        <button
          onClick={toggleFullscreenMode}
          title={isMobileFocusMode ? "Vollbild verlassen" : "Vollbild"}
          aria-label={isMobileFocusMode ? "Vollbild verlassen" : "Vollbild"}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: controlSize, height: controlSize, borderRadius: 8, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)", border: 0, cursor: "pointer" }}
        >
          {isMobileFocusMode ? <Minimize2 size={isMobileFocusMode && isMobile ? 16 : 18} /> : <Maximize2 size={isMobileFocusMode && isMobile ? 16 : 18} />}
        </button>
      )}
    </>
  );

  const mobileMiniSavedRail = (
    <div
      style={{
        position: "fixed",
        left: 8,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 135,
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: 2,
        maxHeight: "72dvh",
        overflow: "hidden",
      }}
    >
      {savedPatterns.slice(0, 8).map((pattern) => (
        <button
          key={`mini-${pattern.id}`}
          onClick={() => loadSavedPattern(pattern.windows)}
                    onPointerDown={(e) => {
            if (e.pointerType === "mouse") return;
            clearLongPressTimeout();
            longPressTimeoutRef.current = window.setTimeout(() => {
              longPressTriggeredPatternRef.current = pattern.id;
              if (navigator.vibrate) navigator.vibrate(25);
              setSavedPatternMenu({ patternId: pattern.id, x: e.clientX, y: e.clientY });
              longPressTimeoutRef.current = null;
            }, 550);
          }}
          onPointerUp={() => clearLongPressTimeout()}
          onPointerCancel={() => clearLongPressTimeout()}
          onPointerLeave={() => clearLongPressTimeout()}
          style={{
            width: 36,
            height: 64,
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: 6,
            background: "rgba(6,10,20,0.9)",
            padding: 0,
            cursor: "pointer",
            overflow: "hidden",
            WebkitTouchCallout: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
          title={`Motiv ${pattern.id} laden`}
        >
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <img
              src={buildingImg}
              alt=""
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.86) contrast(1.08)" }}
            />
            {pattern.windows.flatMap((row, ri) =>
              row.map((lit, ci) => {
                if (!lit) return null;
                const pos = getWindowPos(ri, ci, columns);
                const size = getWindowSize(ci, columns);
                return (
                  <div
                    key={`mini-lit-${pattern.id}-${ri}-${ci}`}
                    style={{
                      position: "absolute",
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      width: `${size.w}%`,
                      height: `${size.h}%`,
                      transform: "translate(-50%, -50%)",
                      background:
                        "radial-gradient(ellipse, rgba(255,235,160,0.95) 0%, rgba(255,210,80,0.7) 60%, rgba(255,180,40,0.3) 100%)",
                      boxShadow: "0 0 4px 1px rgba(255,220,100,0.45)",
                    }}
                  />
                );
              })
            )}
          </div>
        </button>
      ))}
    </div>
  );

  return (
    <div
      onTouchStart={handleFocusTouchStart}
      onTouchMove={handleFocusTouchMove}
      onTouchEnd={handleFocusTouchEnd}
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: isMobileFocusMode ? "space-between" : "center",
        padding: isMobileFocusMode ? (isMobile ? 0 : 8) : 16,
        userSelect: "none",
        background: "#0a0e1a",
        position: isMobileFocusMode ? "fixed" : "relative",
        inset: isMobileFocusMode ? 0 : undefined,
        zIndex: isMobileFocusMode ? 100 : "auto",
        overflow: isMobileFocusMode ? "hidden" : "visible",
      }}
    >
      {(!isMobileFocusMode || !isMobile) && (
        <h1
          style={{
            color: "rgba(255,255,255,0.8)",
            marginBottom: 18,
            marginLeft: isMobile ? 0 : 166,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            fontSize: 14,
            fontWeight: 300,
          }}
        >
          Kongress Center Chemnitz
        </h1>
      )}

      {isMobileFocusMode && isMobile && !isMobileSavedDrawerOpen && mobileMiniSavedRail}

      <div
        style={{
          display: "flex",
          gap: 16,
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "center" : (isMobileFocusMode ? "center" : "flex-start"),
          width: isMobileFocusMode && isMobile ? "100%" : "min(100%, 1200px)",
          justifyContent: isMobileFocusMode && !isMobile ? "center" : "center",
          flex: isMobileFocusMode ? 1 : undefined,
          minHeight: 0,
        }}
      >
        {showDesktopSavedList && savedPatternsPanel}
        {savedPatternMenu && (
          <div
            style={{
              position: "fixed",
              left: savedPatternMenu.x,
              top: savedPatternMenu.y,
              zIndex: 1000,
              minWidth: 182,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(10,12,18,0.98)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              padding: 6,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => deleteSavedPattern(savedPatternMenu.patternId)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                border: 0,
                borderRadius: 8,
                background: "transparent",
                color: "#ff6f6f",
                cursor: "pointer",
              }}
            >
              <Trash2 size={15} /> Löschen
            </button>
          </div>
        )}

        {showMobileSavedDrawer && (
          <>
            {isMobileSavedDrawerOpen && (
              <div
                onClick={() => setIsMobileSavedDrawerOpen(false)}
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 120 }}
              />
            )}
            <div
              style={{
                position: "fixed",
                left: 0,
                top: 0,
                bottom: 0,
                width: "82vw",
                maxWidth: 320,
                background: "rgba(8,12,22,0.98)",
                borderRight: "1px solid rgba(255,255,255,0.14)",
                zIndex: 130,
                transform: isMobileSavedDrawerOpen ? "translateX(0)" : "translateX(-104%)",
                transition: "transform 180ms ease",
                padding: 12,
              }}
            >
              {savedPatternsPanel}
            </div>
          </>
        )}
        {isMobileFocusMode && isMobile && (
          <div
            style={{
              position: "fixed",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 135,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 8,
            }}
          >
            {controlsPanel}
          </div>
        )}

        <div
          style={{
            position: "relative",
            display: "inline-block",
            width: isMobileFocusMode && isMobile ? "100%" : "auto",
            textAlign: "center",
          }}
          ref={imageRef}
          onContextMenu={handleContextMenu}
        >
        <img
          src={buildingImg}
          alt="Kongress Center Chemnitz bei Nacht"
          style={{
            display: "block",
            width: "auto",
            height: isMobileFocusMode && isMobile
              ? "100dvh"
              : isMobile
                ? "min(62vh, 560px)"
              : isMobileFocusMode
                ? "calc(95dvh - 60px)"
                : "min(82vh, 750px)",
            maxWidth: isMobileFocusMode && isMobile ? "100vw" : "100%",
            filter:
              "brightness(0.82) contrast(1.16) saturate(0.93) hue-rotate(2deg) " +
              "drop-shadow(0 4px 12px rgba(0,0,0,0.34))",
          }}
          draggable={false}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at 58% 12%, rgba(78,118,205,0.1) 0%, rgba(12,22,44,0.24) 50%, rgba(4,8,18,0.42) 100%)",
          }}
        />

        {showGrid && (
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 5 }}
          >
            {columns.map((c, i) => (
              <line
                key={i}
                x1={`${c.topX}%`}
                y1={`${c.topY}%`}
                x2={`${c.bottomX}%`}
                y2={`${c.bottomY}%`}
                stroke="rgba(100,180,255,0.4)"
                strokeWidth="1"
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}

        {showGrid &&
          columns.map((c, i) => (
            <div key={i}>
              {(["top", "bottom"] as const).map((end) => {
                const x = end === "top" ? c.topX : c.bottomX;
                const y = end === "top" ? c.topY : c.bottomY;
                const isActive = draggingAnchor?.col === i && draggingAnchor?.end === end;
                return (
                  <div
                    key={end}
                    onMouseDown={(e) => handleAnchorMouseDown(i, end, e)}
                    className="cursor-grab active:cursor-grabbing"
                    style={{
                      position: "absolute",
                      zIndex: 20,
                      left: `${x}%`,
                      top: `${y}%`,
                      width: 14,
                      height: 14,
                      transform: "translate(-50%, -50%)",
                      background: isActive ? "rgba(100,180,255,0.9)" : "rgba(100,180,255,0.6)",
                      border: "2px solid rgba(255,255,255,0.8)",
                      borderRadius: "50%",
                      boxShadow: "0 0 6px rgba(100,180,255,0.5)",
                      transition: isActive ? "none" : "background 0.15s",
                    }}
                    title={`Spalte ${i + 1} ${end === "top" ? "oben" : "unten"}`}
                  />
                );
              })}
            </div>
          ))}

        {!showGrid &&
          !draggingAnchor &&
          windows.map((row, ri) =>
            row.map((lit, ci) => {
              const pos = getWindowPos(ri, ci, columns);
              const size = getWindowSize(ci, columns);
              const hitSize = getWindowHitSize(ci, columns);
              const visualWidth = (size.w / hitSize.w) * 100;
              const visualHeight = (size.h / hitSize.h) * 100;
              const selected = isInSelection(ri, ci);
              return (
                <button
                  key={`${ri}-${ci}`}
                  data-cell="1"
                  data-row={ri}
                  data-col={ci}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    // Start selection on second click while mouse is held.
                    if (e.pointerType === "mouse" && e.detail >= 2) {
                      e.preventDefault();
                      if (isPainting) {
                        setIsPainting(false);
                        paintStartWindows.current = null;
                        paintStartCell.current = null;
                        paintStartedFromLit.current = false;
                        paintMoved.current = false;
                      }
                      handleSelectionStart(ri, ci);
                      return;
                    }
                    handleLeftDown(ri, ci);
                  }}
                  onPointerEnter={() => {
                    handleLeftEnter(ri, ci);
                    handleSelectionEnter(ri, ci);
                  }}
                  onPointerUp={() => {
                    handleLeftUp();
                    handleSelectionUp();
                  }}
                  className="transition-all duration-200 border-0 outline-none cursor-pointer"
                  style={{
                    position: "absolute",
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    width: `${hitSize.w}%`,
                    height: `${hitSize.h}%`,
                    transform: "translate(-50%, -50%)",
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    touchAction: "none",
                    zIndex: selected ? 3 : 1,
                  }}
                  aria-label={`Fenster Reihe ${ri + 1}, Spalte ${ci + 1} – ${lit ? "an" : "aus"}`}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      width: `${visualWidth}%`,
                      height: `${visualHeight}%`,
                      transform: "translate(-50%, -50%)",
                      transition: "all 200ms",
                      background: lit
                        ? "radial-gradient(ellipse, rgba(255,235,160,0.95) 0%, rgba(255,210,80,0.7) 60%, rgba(255,180,40,0.3) 100%)"
                        : selected
                          ? "rgba(100,150,255,0.25)"
                          : "transparent",
                      boxShadow: lit
                        ? "0 0 8px 2px rgba(255,220,100,0.5), 0 0 20px 4px rgba(255,200,60,0.2)"
                        : "none",
                      border: selected
                        ? "1px solid rgba(100,150,255,0.6)"
                        : "1px solid rgba(255,255,255,0.08)",
                    }}
                  />
                </button>
              );
            })
          )}
        </div>
                {!isMobile && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginLeft: 10,
              padding: 8,
              alignSelf: "center",
            }}
          >
            {controlsPanel}
          </div>
        )}
      </div>

      {(!isMobileFocusMode || !isMobile) && isMobile && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: isMobileFocusMode ? 6 : 24,
            flexWrap: "wrap",
            justifyContent: "center",
            marginLeft: isMobile ? 0 : 166,
          }}
        >
          {controlsPanel}
        </div>
      )}

      {showGrid && (
        <div
          style={{
            marginTop: 14,
            width: "min(100%, 860px)",
            marginLeft: isMobile ? 0 : 166,
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 10,
            padding: 12,
            background: "rgba(8,13,25,0.7)",
            color: "rgba(255,255,255,0.85)",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button
              onClick={() => setColumns(makeDefaultColumns())}
              style={{ padding: "6px 10px", borderRadius: 6, border: 0, cursor: "pointer" }}
            >
              Anker zuruecksetzen
            </button>
            <button
              onClick={exportAnchors}
              style={{ padding: "6px 10px", borderRadius: 6, border: 0, cursor: "pointer" }}
            >
              Ankerpunkte kopieren (JSON)
            </button>
          </div>
          <div
            style={{
              maxHeight: 180,
              overflow: "auto",
              borderTop: "1px solid rgba(255,255,255,0.14)",
              paddingTop: 8,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {columns.map((c, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                S{i + 1}: top({c.topX.toFixed(1)}, {c.topY.toFixed(1)}) · bottom({c.bottomX.toFixed(1)},{" "}
                {c.bottomY.toFixed(1)})
              </div>
            ))}
          </div>
        </div>
      )}

      {!(isMobileFocusMode && isMobile) && (
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: isMobileFocusMode && !isMobile ? 4 : isMobileFocusMode ? 8 : 12, marginBottom: isMobileFocusMode && !isMobile ? 6 : 0, marginLeft: isMobile ? 0 : 166 }}>
          {litCount} von {ROWS * COLS} Fenster beleuchtet
          {hasSelection && " · Bereich ausgewaehlt (Doppelklick + Ziehen)"}
        </p>
      )}
      {isMobileFocusMode && isMobile && (
        <div
          style={{
            position: "fixed",
            bottom: 10,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(8,12,22,0.7)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.85)",
            fontSize: 12,
            zIndex: 136,
          }}
        >
          {litCount} von {ROWS * COLS} beleuchtet
        </div>
      )}
    </div>
  );
};

export default App;
