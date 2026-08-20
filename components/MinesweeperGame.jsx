"use client";

import { useEffect, useRef, useState } from "react";

const DIFFICULTIES = [
  { id: "rookie", label: "Rookie", rows: 9, cols: 9, mines: 10 },
  { id: "pro", label: "Pro", rows: 16, cols: 16, mines: 40 },
  { id: "legend", label: "Legend", rows: 16, cols: 30, mines: 99 },
];

const NUMBER_COLORS = [
  "",
  "text-blue-600 dark:text-blue-400",
  "text-green-700 dark:text-green-400",
  "text-red-600 dark:text-red-400",
  "text-indigo-700 dark:text-indigo-400",
  "text-amber-700 dark:text-amber-500",
  "text-teal-700 dark:text-teal-400",
  "text-gray-900 dark:text-gray-100",
  "text-gray-500 dark:text-gray-400",
];

const LONG_PRESS_MS = 400;

function makeBoard(rows, cols) {
  const board = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) {
      row.push({ mine: false, revealed: false, flagged: false, adj: 0, boom: false });
    }
    board.push(row);
  }
  return board;
}

function neighborsOf(rows, cols, r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push([nr, nc]);
    }
  }
  return out;
}

function placeMines(board, mineCount, safeR, safeC) {
  const rows = board.length;
  const cols = board[0].length;
  const offLimits = new Set([safeR * cols + safeC]);
  neighborsOf(rows, cols, safeR, safeC).forEach(function (p) {
    offLimits.add(p[0] * cols + p[1]);
  });
  const spots = [];
  for (let i = 0; i < rows * cols; i += 1) {
    if (!offLimits.has(i)) spots.push(i);
  }
  for (let i = spots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = spots[i];
    spots[i] = spots[j];
    spots[j] = tmp;
  }
  spots.slice(0, mineCount).forEach(function (idx) {
    board[Math.floor(idx / cols)][idx % cols].mine = true;
  });
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      board[r][c].adj = neighborsOf(rows, cols, r, c).filter(function (p) {
        return board[p[0]][p[1]].mine;
      }).length;
    }
  }
}

function floodReveal(board, startR, startC) {
  const rows = board.length;
  const cols = board[0].length;
  const stack = [[startR, startC]];
  while (stack.length > 0) {
    const cur = stack.pop();
    const cell = board[cur[0]][cur[1]];
    if (cell.revealed || cell.flagged) continue;
    cell.revealed = true;
    if (cell.adj === 0 && !cell.mine) {
      neighborsOf(rows, cols, cur[0], cur[1]).forEach(function (p) {
        if (!board[p[0]][p[1]].revealed) stack.push(p);
      });
    }
  }
}

function cloneBoard(board) {
  return board.map(function (row) {
    return row.map(function (cell) {
      return {
        mine: cell.mine,
        revealed: cell.revealed,
        flagged: cell.flagged,
        adj: cell.adj,
        boom: cell.boom,
      };
    });
  });
}

export default function MinesweeperGame() {
  const [diffIndex, setDiffIndex] = useState(0);
  const [board, setBoard] = useState(function () {
    return makeBoard(DIFFICULTIES[0].rows, DIFFICULTIES[0].cols);
  });
  const [minesPlaced, setMinesPlaced] = useState(false);
  const [status, setStatus] = useState("idle");
  const [flagMode, setFlagMode] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const longPressTimer = useRef(null);
  const suppressClick = useRef(false);

  const diff = DIFFICULTIES[diffIndex];

  useEffect(function () {
    if (status !== "playing") return undefined;
    const id = setInterval(function () {
      setSeconds(function (s) {
        return Math.min(s + 1, 999);
      });
    }, 1000);
    return function () {
      clearInterval(id);
    };
  }, [status]);

  let flagCount = 0;
  board.forEach(function (row) {
    row.forEach(function (cell) {
      if (cell.flagged) flagCount += 1;
    });
  });
  const minesLeft = diff.mines - flagCount;

  function reset(nextIndex) {
    const idx = typeof nextIndex === "number" ? nextIndex : diffIndex;
    const d = DIFFICULTIES[idx];
    setDiffIndex(idx);
    setBoard(makeBoard(d.rows, d.cols));
    setMinesPlaced(false);
    setStatus("idle");
    setSeconds(0);
  }

  function revealAt(r, c) {
    if (status === "won" || status === "lost") return;
    const next = cloneBoard(board);
    if (!minesPlaced) {
      placeMines(next, diff.mines, r, c);
      setMinesPlaced(true);
    }
    const cell = next[r][c];
    if (cell.flagged || cell.revealed) {
      setBoard(next);
      if (status === "idle") setStatus("playing");
      return;
    }
    if (cell.mine) {
      cell.boom = true;
      next.forEach(function (row) {
        row.forEach(function (x) {
          if (x.mine) x.revealed = true;
        });
      });
      setBoard(next);
      setStatus("lost");
      return;
    }
    floodReveal(next, r, c);
    let hiddenSafe = 0;
    next.forEach(function (row) {
      row.forEach(function (x) {
        if (!x.mine && !x.revealed) hiddenSafe += 1;
      });
    });
    if (hiddenSafe === 0) {
      next.forEach(function (row) {
        row.forEach(function (x) {
          if (x.mine) x.flagged = true;
        });
      });
      setBoard(next);
      setStatus("won");
      return;
    }
    setBoard(next);
    if (status === "idle") setStatus("playing");
  }

  function toggleFlag(r, c) {
    if (status === "won" || status === "lost") return;
    if (board[r][c].revealed) return;
    const next = cloneBoard(board);
    next[r][c].flagged = !next[r][c].flagged;
    setBoard(next);
    if (status === "idle") setStatus("playing");
  }

  function pressFlag(r, c) {
    if (suppressClick.current) return;
    suppressClick.current = true;
    toggleFlag(r, c);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(30);
  }

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function cellFace(cell) {
    if (status === "lost" && cell.flagged && !cell.mine) return "\u274C";
    if (!cell.revealed) return cell.flagged ? "\uD83D\uDEA9" : "";
    if (cell.mine) return "\uD83D\uDCA3";
    return cell.adj > 0 ? String(cell.adj) : "";
  }

  function cellClasses(cell) {
    const base =
      "flex h-[1.9rem] w-[1.9rem] touch-manipulation items-center justify-center text-sm font-bold leading-none focus:outline-none ";
    if (cell.revealed) {
      if (cell.boom) return base + "bg-red-500 text-white";
      return base + "bg-gray-100 dark:bg-gray-800 " + (cell.mine ? "" : NUMBER_COLORS[cell.adj]);
    }
    return base + "bg-gray-300 hover:bg-gray-200 active:bg-gray-200 dark:bg-gray-500 dark:hover:bg-gray-400";
  }

  const face = status === "lost" ? "\uD83D\uDE35" : status === "won" ? "\uD83D\uDE0E" : "\uD83D\uDE42";

  return (
    <div className="select-none">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {DIFFICULTIES.map(function (d, i) {
          return (
            <button
              key={d.id}
              type="button"
              onClick={function () {
                reset(i);
              }}
              className={
                "rounded-md border px-3 py-1 font-display text-sm uppercase tracking-widest transition-colors " +
                (i === diffIndex
                  ? "border-espn bg-espn text-white"
                  : "border-gray-300 text-gray-600 hover:border-espn hover:text-espn dark:border-gray-600 dark:text-gray-300")
              }
            >
              {d.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={function () {
            setFlagMode(!flagMode);
          }}
          aria-pressed={flagMode}
          className={
            "rounded-md border px-3 py-1 font-display text-sm uppercase tracking-widest transition-colors " +
            (flagMode
              ? "border-espn bg-espn text-white"
              : "border-gray-300 text-gray-600 hover:border-espn hover:text-espn dark:border-gray-600 dark:text-gray-300")
          }
        >
          {"\uD83D\uDEA9"} Flag mode {flagMode ? "on" : "off"}
        </button>
      </div>

      <div className="mb-3 flex max-w-md items-center justify-between rounded-md border border-gray-300 bg-gray-100 px-4 py-2 font-mono text-lg dark:border-gray-600 dark:bg-gray-800">
        <span className="text-red-600 dark:text-red-400">{"\uD83D\uDCA3"} {minesLeft}</span>
        <button
          type="button"
          onClick={function () {
            reset();
          }}
          aria-label="New game"
          className="text-2xl leading-none transition-transform hover:scale-110"
        >
          {face}
        </button>
        <span className="text-gray-700 dark:text-gray-300">{"\u23F1"} {seconds}</span>
      </div>

      {status === "lost" && (
        <div className="mb-3 max-w-md rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          <strong>Boom.</strong> That one had your name on it. Hit the face to try again.
        </div>
      )}
      {status === "won" && (
        <div className="mb-3 max-w-md rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200">
          <strong>Field cleared in {seconds}s.</strong> The commissioner remains undefeated.
        </div>
      )}

      <div className="overflow-x-auto pb-2">
        <div
          className="inline-grid gap-px rounded-md border-2 border-gray-400 bg-gray-400 p-px dark:border-gray-600 dark:bg-gray-600"
          style={{ gridTemplateColumns: "repeat(" + diff.cols + ", 1.9rem)" }}
          onContextMenu={function (e) {
            e.preventDefault();
          }}
        >
          {board.map(function (row, r) {
            return row.map(function (cell, c) {
              return (
                <button
                  key={r + "-" + c}
                  type="button"
                  aria-label={"Cell " + (r + 1) + "," + (c + 1)}
                  className={cellClasses(cell)}
                  onMouseDown={function () {
                    suppressClick.current = false;
                  }}
                  onClick={function () {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    if (flagMode) toggleFlag(r, c);
                    else revealAt(r, c);
                  }}
                  onContextMenu={function (e) {
                    e.preventDefault();
                    clearLongPress();
                    pressFlag(r, c);
                  }}
                  onTouchStart={function () {
                    suppressClick.current = false;
                    clearLongPress();
                    longPressTimer.current = setTimeout(function () {
                      longPressTimer.current = null;
                      pressFlag(r, c);
                    }, LONG_PRESS_MS);
                  }}
                  onTouchEnd={clearLongPress}
                  onTouchMove={clearLongPress}
                  onTouchCancel={clearLongPress}
                >
                  {cellFace(cell)}
                </button>
              );
            });
          })}
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Click or tap to reveal a square. Right-click, long-press, or switch on flag
        mode to plant a flag. Numbers count the mines in the surrounding eight
        squares. Your first click is always safe.
      </p>
    </div>
  );
}
