/* Tetris rules and candidate scoring.
 *
 * The engine is intentionally dependency-free and usable from both the
 * browser (window.TetrisEngine) and Node (module.exports), so the move
 * generator can be tested without a browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TetrisEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COLS = 10;
  const ROWS = 20;
  const EMPTY = ".";

  const COLORS = {
    I: "#37e7ff",
    J: "#6c8cff",
    L: "#ffb84d",
    O: "#ffe66d",
    S: "#66f2a3",
    T: "#d58cff",
    Z: "#ff6b8b",
  };

  const BASE_SHAPES = {
    I: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    J: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    L: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    O: [
      [1, 1],
      [1, 1],
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
  };

  const PIECE_TYPES = Object.keys(BASE_SHAPES);

  function rotateMatrix(matrix) {
    const height = matrix.length;
    const width = matrix[0].length;
    const rotated = [];
    for (let r = 0; r < width; r += 1) {
      const row = [];
      for (let c = 0; c < height; c += 1) {
        row.push(matrix[height - 1 - c][r]);
      }
      rotated.push(row);
    }
    return rotated;
  }

  function trimMatrix(matrix) {
    let top = 0;
    let bottom = matrix.length;
    let left = 0;
    let right = matrix[0].length;

    while (top < bottom && matrix[top].every((value) => !value)) top += 1;
    while (bottom > top && matrix[bottom - 1].every((value) => !value)) bottom -= 1;
    while (left < right && matrix.every((row) => !row[left])) left += 1;
    while (right > left && matrix.every((row) => !row[right - 1])) right -= 1;

    if (top === bottom || left === right) return [];

    return matrix.slice(top, bottom).map((row) => row.slice(left, right));
  }

  function signature(matrix) {
    return matrix.map((row) => row.join("")).join("/");
  }

  function buildRotations(base) {
    const rotations = [];
    const seen = new Set();
    let matrix = trimMatrix(base);
    for (let i = 0; i < 4; i += 1) {
      if (!matrix.length) break;
      const sig = signature(matrix);
      if (!seen.has(sig)) {
        seen.add(sig);
        rotations.push({ matrix, signature: sig });
      }
      matrix = trimMatrix(rotateMatrix(matrix));
    }
    return rotations;
  }

  const SHAPES = {};
  PIECE_TYPES.forEach((type) => {
    SHAPES[type] = buildRotations(BASE_SHAPES[type]);
  });

  function createBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function cloneBoard(board) {
    return board.map((row) => row.slice());
  }

  function boardToLines(board) {
    return board.map((row) => row.map((cell) => cell || EMPTY).join(""));
  }

  function matrixCells(matrix, x, y) {
    const cells = [];
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix[r].length; c += 1) {
        if (matrix[r][c]) cells.push([x + c, y + r]);
      }
    }
    return cells;
  }

  function canPlace(board, matrix, x, y) {
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix[r].length; c += 1) {
        if (!matrix[r][c]) continue;
        const boardX = x + c;
        const boardY = y + r;
        if (boardX < 0 || boardX >= COLS || boardY < 0 || boardY >= ROWS) {
          return false;
        }
        if (board[boardY][boardX]) return false;
      }
    }
    return true;
  }

  function spawnPiece(board, type) {
    const rotations = SHAPES[type];
    if (!rotations || !rotations.length) return null;
    const matrix = rotations[0].matrix;
    const x = Math.floor((COLS - matrix[0].length) / 2);
    if (!canPlace(board, matrix, x, 0)) return null;
    return {
      type,
      rotation: 0,
      x,
      y: 0,
      matrix,
      width: matrix[0].length,
      height: matrix.length,
    };
  }

  function landingRow(board, matrix, x) {
    if (!canPlace(board, matrix, x, 0)) return null;
    let y = 0;
    while (canPlace(board, matrix, x, y + 1)) y += 1;
    return y;
  }

  function clearRows(board) {
    const remaining = [];
    const clearedRows = [];
    for (let r = 0; r < ROWS; r += 1) {
      const full = board[r].every(Boolean);
      if (full) {
        clearedRows.push(r);
      } else {
        remaining.push(board[r].slice());
      }
    }
    while (remaining.length < ROWS) {
      remaining.unshift(Array(COLS).fill(null));
    }
    return { board: remaining, clearedRows, count: clearedRows.length };
  }

  function columnHeights(board) {
    const heights = Array(COLS).fill(0);
    for (let c = 0; c < COLS; c += 1) {
      for (let r = 0; r < ROWS; r += 1) {
        if (board[r][c]) {
          heights[c] = ROWS - r;
          break;
        }
      }
    }
    return heights;
  }

  function countHoles(board) {
    let holes = 0;
    for (let c = 0; c < COLS; c += 1) {
      let seenBlock = false;
      for (let r = 0; r < ROWS; r += 1) {
        if (board[r][c]) {
          seenBlock = true;
        } else if (seenBlock) {
          holes += 1;
        }
      }
    }
    return holes;
  }

  function countWells(heights) {
    let wells = 0;
    for (let c = 1; c < COLS - 1; c += 1) {
      const depth = Math.min(heights[c - 1], heights[c + 1]) - heights[c];
      if (depth > 0) wells += depth;
    }
    return wells;
  }

  function evaluateBoard(board, cleared, matrix, x, y, holesBefore) {
    const heights = columnHeights(board);
    const aggregateHeight = heights.reduce((sum, value) => sum + value, 0);
    const maxHeight = Math.max(...heights);
    let bumpiness = 0;
    for (let c = 0; c < COLS - 1; c += 1) {
      bumpiness += Math.abs(heights[c] - heights[c + 1]);
    }
    const holes = countHoles(board);
    const wells = countWells(heights);
    const topDanger = maxHeight > 14 ? (maxHeight - 14) * (maxHeight - 14) * 0.75 : 0;
    const heuristic =
      cleared * 3.1 -
      holes * 1.8 -
      Math.max(0, holes - holesBefore) * 0.9 -
      aggregateHeight * 0.035 -
      bumpiness * 0.22 -
      wells * 0.16 -
      topDanger;

    return {
      linesCleared: cleared,
      holes,
      holesAdded: Math.max(0, holes - holesBefore),
      aggregateHeight,
      maxHeight,
      bumpiness,
      wells,
      landingHeight: ROWS - (y + matrix.length),
      heuristic: Math.round(heuristic * 100) / 100,
      heights,
      columnCount: x,
    };
  }

  function findPlacements(board, type) {
    const rotations = SHAPES[type];
    if (!rotations) return [];
    const holesBefore = countHoles(board);
    const placements = [];
    const seen = new Set();

    rotations.forEach((rotationData, rotation) => {
      const matrix = rotationData.matrix;
      const width = matrix[0].length;
      const maxX = COLS - width;

      for (let x = 0; x <= maxX; x += 1) {
        if (!canPlace(board, matrix, x, 0)) continue;
        let y = 0;
        while (canPlace(board, matrix, x, y + 1)) y += 1;

        const key = `${rotation}:${x}:${y}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const mergedBoard = cloneBoard(board);
        const cells = matrixCells(matrix, x, y);
        cells.forEach(([cellX, cellY]) => {
          mergedBoard[cellY][cellX] = type;
        });

        const clearedBoard = clearRows(mergedBoard);
        const features = evaluateBoard(
          clearedBoard.board,
          clearedBoard.count,
          matrix,
          x,
          y,
          holesBefore
        );

        placements.push({
          type,
          rotation,
          column: x,
          row: y,
          width,
          height: matrix.length,
          matrix,
          cells,
          mergedBoard,
          board: clearedBoard.board,
          clearedRows: clearedBoard.clearedRows,
          ...features,
        });
      }
    });

    return placements;
  }

  function findShortlist(board, type, limit = 8) {
    const all = findPlacements(board, type);
    const ranked = all
      .map((placement, index) => ({ placement, index }))
      .sort((a, b) => {
        if (b.placement.heuristic !== a.placement.heuristic) {
          return b.placement.heuristic - a.placement.heuristic;
        }
        if (a.placement.column !== b.placement.column) {
          return a.placement.column - b.placement.column;
        }
        return a.placement.rotation - b.placement.rotation;
      })
      .map((entry, rank) => ({ ...entry.placement, heuristicRank: rank + 1 }));

    const selected = [];
    const selectedKeys = new Set();
    const add = (placement) => {
      if (!placement || selected.length >= Math.max(1, limit)) return;
      const key = `${placement.rotation}:${placement.column}:${placement.row}`;
      if (selectedKeys.has(key)) return;
      selectedKeys.add(key);
      selected.push(placement);
    };

    // Keep the best placement for each shape orientation in the mix. This
    // gives Jev meaningful rotation choices instead of eight look-alike
    // columns, while still seeding the list with the globally best move.
    add(ranked[0]);
    for (let rotation = 0; rotation < 4; rotation += 1) {
      add(ranked.find((placement) => placement.rotation === rotation));
    }
    add(ranked.find((placement) => placement.linesCleared > 0));
    ranked.forEach(add);

    selected.sort((a, b) => {
      if (a.column !== b.column) return a.column - b.column;
      return a.rotation - b.rotation;
    });

    return {
      all,
      shortlist: selected.slice(0, Math.max(1, limit)).map((placement, index) => ({
        ...placement,
        id: `c${index + 1}`,
      })),
      heuristicBest: ranked[0] || null,
    };
  }

  function makeBag(random = Math.random) {
    const bag = PIECE_TYPES.slice();
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  return {
    COLS,
    ROWS,
    EMPTY,
    COLORS,
    PIECE_TYPES,
    SHAPES,
    createBoard,
    cloneBoard,
    boardToLines,
    matrixCells,
    canPlace,
    spawnPiece,
    landingRow,
    clearRows,
    columnHeights,
    countHoles,
    findPlacements,
    findShortlist,
    makeBag,
  };
});
