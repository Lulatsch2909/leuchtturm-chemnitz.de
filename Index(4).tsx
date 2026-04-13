import { useState, useCallback, useEffect, useRef } from "react";
import buildingImg from "@/assets/building-night.jpg";
import { Undo2, Redo2, RotateCcw, Copy, ClipboardPaste } from "lucide-react";

const ROWS = 26;
const COLS = 9;

// Each column has a top and bottom anchor point (in % of image)
type ColumnAnchors = { topX: number; topY: number; bottomX: number; bottomY: number };

function makeDefaultColumns(): ColumnAnchors[] {
  const tl = { x: 13, y: 5 };
  const tr = { x: 72, y: 8 };
  const bl = { x: 11, y: 62 };
  const br = { x: 76, y: 62 };
  return Array.from({ length: COLS }, (_, c) => {
    const u = c / (COLS - 1);
    return {
      topX: tl.x + u * (tr.x - tl.x),
      topY: tl.y + u * (tr.y - tl.y),
      bottomX: bl.x + u * (br.x - bl.x),
      bottomY: bl.y + u * (br.y - bl.y),
    };
  });
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
  // Width: half distance to neighbors
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
    w = Math.abs(next.topX - prev.topX) / 2 * 0.75;
  }
  const c = columns[col];
  const h = Math.abs(c.bottomY - c.topY) / ROWS * 0.72;
  return { w, h };
}

type Selection = { startRow: number; startCol: number; endRow: number; endCol: number } | null;

function normalizeSelection(sel: NonNullable<Selection>) {
  return {
    r1: Math.min(sel.startRow, sel.endRow),
    r2: Math.max(sel.startRow, sel.endRow),
    c1: Math.min(sel.startCol, sel.endCol),
    c2: Math.max(sel.startCol, sel.endCol),
  };
}

type DraggingAnchor = { col: number; end: "top" | "bottom" } | null;

const Index = () => {
  const [columns, setColumns] = useState<ColumnAnchors[]>(makeDefaultColumns);
  const [windows, setWindows] = useState<boolean[][]>(() =>
    Array.from({ length: ROWS }, () => Array(COLS).fill(false))
  );
  const [history, setHistory] = useState<{ prev: boolean[][]; next: boolean[][] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selection, setSelection] = useState<Selection>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [clipboard, setClipboard] = useState<boolean[][] | null>(null);
  const [lastClickedCell, setLastClickedCell] = useState<{ row: number; col: number } | null>(null);
  const [draggingAnchor, setDraggingAnchor] = useState<DraggingAnchor>(null);
  const [showGrid, setShowGrid] = useState(() => new URLSearchParams(window.location.search).has('config'));
  const imageRef = useRef<HTMLDivElement>(null);
  const paintStartWindows = useRef<boolean[][] | null>(null);

  const pushHistory = useCallback((prev: boolean[][], next: boolean[][]) => {
    setHistory(h => {
      const newH = h.slice(0, historyIndex + 1);
      newH.push({ prev: prev.map(r => [...r]), next: next.map(r => [...r]) });
      return newH;
    });
    setHistoryIndex(i => i + 1);
  }, [historyIndex]);

  // Left-click: paint windows ON
  const handleLeftDown = useCallback((row: number, col: number, e: React.MouseEvent) => {
    if (e.button !== 0 || draggingAnchor || showGrid) return;
    e.preventDefault();
    setSelection(null);
    setLastClickedCell({ row, col });
    paintStartWindows.current = windows.map(r => [...r]);
    setIsPainting(true);
    setWindows(prev => {
      const next = prev.map(r => [...r]);
      next[row][col] = !next[row][col];
      return next;
    });
  }, [draggingAnchor, showGrid, windows]);

  const handleLeftEnter = useCallback((row: number, col: number) => {
    if (!isPainting) return;
    setWindows(prev => {
      const next = prev.map(r => [...r]);
      next[row][col] = true;
      return next;
    });
  }, [isPainting]);

  const handleLeftUp = useCallback(() => {
    if (isPainting && paintStartWindows.current) {
      pushHistory(paintStartWindows.current, windows);
      paintStartWindows.current = null;
    }
    setIsPainting(false);
  }, [isPainting, windows, pushHistory]);

  // Right-click: select area for copy
  const handleRightDown = useCallback((row: number, col: number, e: React.MouseEvent) => {
    if (e.button !== 2 || draggingAnchor || showGrid) return;
    e.preventDefault();
    setIsSelecting(true);
    setSelection({ startRow: row, startCol: col, endRow: row, endCol: col });
    setLastClickedCell(null);
  }, [draggingAnchor, showGrid]);

  const handleRightEnter = useCallback((row: number, col: number) => {
    if (!isSelecting) return;
    setSelection(prev => prev ? { ...prev, endRow: row, endCol: col } : null);
  }, [isSelecting]);

  const handleRightUp = useCallback(() => {
    setIsSelecting(false);
  }, []);

  // Prevent context menu on grid
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Column anchor dragging
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
      setColumns(prev => {
        const next = [...prev];
        const c = { ...next[draggingAnchor.col] };
        if (draggingAnchor.end === "top") { c.topX = cx; c.topY = cy; }
        else { c.bottomX = cx; c.bottomY = cy; }
        next[draggingAnchor.col] = c;
        return next;
      });
    };
    const handleUp = () => setDraggingAnchor(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
  }, [draggingAnchor]);

  // Global mouse up
  useEffect(() => {
    const handler = () => { setIsPainting(false); setIsSelecting(false); };
    window.addEventListener("mouseup", handler);
    return () => window.removeEventListener("mouseup", handler);
  }, []);

  const undo = useCallback(() => {
    if (historyIndex < 0) return;
    setWindows(history[historyIndex].prev.map(r => [...r]));
    setHistoryIndex(i => i - 1);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    setWindows(history[historyIndex + 1].next.map(r => [...r]));
    setHistoryIndex(i => i + 1);
  }, [history, historyIndex]);

  const resetAll = useCallback(() => {
    const prev = windows.map(r => [...r]);
    const next = Array.from({ length: ROWS }, () => Array(COLS).fill(false)) as boolean[][];
    pushHistory(prev, next);
    setWindows(next);
    setSelection(null);
    setLastClickedCell(null);
  }, [windows, pushHistory]);

  const copySelection = useCallback(() => {
    if (!selection) return;
    const { r1, r2, c1, c2 } = normalizeSelection(selection);
    const copied: boolean[][] = [];
    for (let r = r1; r <= r2; r++) {
      const row: boolean[] = [];
      for (let c = c1; c <= c2; c++) row.push(windows[r][c]);
      copied.push(row);
    }
    setClipboard(copied);
  }, [selection, windows]);

  const pasteAtTarget = useCallback(() => {
    if (!clipboard || !lastClickedCell) return;
    const prev = windows.map(r => [...r]);
    const next = prev.map(r => [...r]);
    for (let r = 0; r < clipboard.length; r++) {
      for (let c = 0; c < clipboard[0].length; c++) {
        const tr = lastClickedCell.row + r, tc = lastClickedCell.col + c;
        if (tr < ROWS && tc < COLS) next[tr][tc] = clipboard[r][c];
      }
    }
    pushHistory(prev, next);
    setWindows(next);
  }, [clipboard, lastClickedCell, windows, pushHistory]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "c") { e.preventDefault(); copySelection(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") { e.preventDefault(); pasteAtTarget(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [copySelection, pasteAtTarget, undo, redo]);

  const isInSelection = (row: number, col: number) => {
    if (!selection) return false;
    const { r1, r2, c1, c2 } = normalizeSelection(selection);
    return row >= r1 && row <= r2 && col >= c1 && col <= c2;
  };


  const litCount = windows.flat().filter(Boolean).length;
  const hasSelection = selection && (selection.startRow !== selection.endRow || selection.startCol !== selection.endCol);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 select-none" style={{ background: "#0a0e1a" }}>
      <h1 className="text-sm tracking-[0.3em] uppercase mb-6 font-light" style={{ color: "rgba(255,255,255,0.8)" }}>
        Kongress Center Chemnitz
      </h1>

      <div className="relative inline-block" ref={imageRef} onContextMenu={handleContextMenu}>
        <img
          src={buildingImg}
          alt="Kongress Center Chemnitz bei Nacht"
          className="block w-auto"
          style={{ height: "min(82vh, 750px)" }}
          draggable={false}
        />

        {/* Column lines in config mode */}
        {showGrid && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 5 }}>
            {columns.map((c, i) => (
              <line
                key={i}
                x1={`${c.topX}%`} y1={`${c.topY}%`}
                x2={`${c.bottomX}%`} y2={`${c.bottomY}%`}
                stroke="rgba(100,180,255,0.4)"
                strokeWidth="1"
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}

        {/* Draggable anchor handles (top + bottom per column) */}
        {showGrid && columns.map((c, i) => (
          <div key={i}>
            {(["top", "bottom"] as const).map(end => {
              const x = end === "top" ? c.topX : c.bottomX;
              const y = end === "top" ? c.topY : c.bottomY;
              const isActive = draggingAnchor?.col === i && draggingAnchor?.end === end;
              return (
                <div
                  key={end}
                  onMouseDown={(e) => handleAnchorMouseDown(i, end, e)}
                  className="absolute z-10 cursor-grab active:cursor-grabbing"
                  style={{
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

        {/* Window grid */}
        {!draggingAnchor && windows.map((row, ri) =>
          row.map((lit, ci) => {
            const pos = getWindowPos(ri, ci, columns);
            const size = getWindowSize(ci, columns);
            const selected = isInSelection(ri, ci);
            return (
              <button
                key={`${ri}-${ci}`}
                onMouseDown={(e) => {
                  if (e.button === 0) handleLeftDown(ri, ci, e);
                  if (e.button === 2) handleRightDown(ri, ci, e);
                }}
                onMouseEnter={() => {
                  handleLeftEnter(ri, ci);
                  handleRightEnter(ri, ci);
                }}
                onMouseUp={() => {
                  handleLeftUp();
                  handleRightUp();
                }}
                className="absolute transition-all duration-200 border-0 outline-none cursor-pointer"
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  width: `${size.w}%`,
                  height: `${size.h}%`,
                  transform: "translate(-50%, -50%)",
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
                    : "1px solid transparent",
                  zIndex: selected ? 2 : 1,
                }}
                aria-label={`Fenster Reihe ${ri + 1}, Spalte ${ci + 1} – ${lit ? "an" : "aus"}`}
              />
            );
          })
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mt-6 flex-wrap justify-center">
        <button onClick={undo} disabled={historyIndex < 0}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }}>
          <Undo2 size={16} /> Zurück
        </button>
        <button onClick={redo} disabled={historyIndex >= history.length - 1}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }}>
          Vor <Redo2 size={16} />
        </button>
        <button onClick={resetAll}
          className="flex items-center gap-2 px-4 py-2 rounded transition-colors text-sm"
          style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }}>
          <RotateCcw size={16} /> Alle aus
        </button>

        <div className="w-px h-6" style={{ background: "rgba(255,255,255,0.2)" }} />

        <button onClick={copySelection} disabled={!hasSelection}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }} title="Ctrl+C">
          <Copy size={16} /> Kopieren
        </button>
        <button onClick={pasteAtTarget} disabled={!clipboard || !lastClickedCell}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }} title="Ctrl+V">
          <ClipboardPaste size={16} /> Einfügen
        </button>
      </div>

      <p className="text-xs mt-3" style={{ color: "rgba(255,255,255,0.4)" }}>
        {litCount} von {ROWS * COLS} Fenster beleuchtet
        {hasSelection && " · Bereich ausgewählt (Rechtsklick)"}
        {clipboard && " · Zwischenablage gefüllt"}
      </p>
      <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
        Linksklick + Ziehen = Lichter anschalten · Rechtsklick + Ziehen = Bereich auswählen · Strg+C/V
      </p>
    </div>
  );
};

export default Index;
