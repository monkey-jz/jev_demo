/* Browser game loop and live Jev trace viewer. */
(function () {
  "use strict";

  const E = window.TetrisEngine;
  if (!E) {
    document.body.innerHTML = "<p style=\"padding:32px;color:#fff\">engine.js 加载失败。</p>";
    throw new Error("TetrisEngine is missing");
  }

  const CELL = 28;
  const BOARD_W = E.COLS * CELL;
  const BOARD_H = E.ROWS * CELL;
  const NEXT_W = 96;
  const NEXT_H = 204;
  const NEXT_SLOT = NEXT_H / 3;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const HISTORY_LIMIT = 10;
  const LOG_LIMIT = 12;
  const DEFAULT_DECISION_EMPTY =
    "开始后，这里会显示每一步的选择、置信度与安全信号。";

  const LINE_SCORES = [0, 100, 300, 500, 800];
  const numberFormat = new Intl.NumberFormat("en-US");

  // The active piece falls slowly while Jev is thinking. This only affects the
  // visual layer; the board snapshot sent to Jev never changes.
  const WAIT_FALL_MS_PER_ROW = 320;
  const WAIT_FALL_MIN_MS = 1800;

  const dom = {
    serverPill: document.getElementById("serverPill"),
    serverStatus: document.getElementById("serverStatus"),
    topCalls: document.getElementById("topCalls"),
    topTokens: document.getElementById("topTokens"),

    gameStatus: document.getElementById("gameStatus"),
    gameStatusText: document.getElementById("gameStatusText"),
    boardCanvas: document.getElementById("boardCanvas"),
    nextCanvas: document.getElementById("nextCanvas"),
    startOverlay: document.getElementById("startOverlay"),
    startBtn: document.getElementById("startBtn"),
    gameOverOverlay: document.getElementById("gameOverOverlay"),
    gameOverReason: document.getElementById("gameOverReason"),
    finalScore: document.getElementById("finalScore"),
    finalLines: document.getElementById("finalLines"),
    finalCalls: document.getElementById("finalCalls"),
    restartOverlayBtn: document.getElementById("restartOverlayBtn"),
    pauseBanner: document.getElementById("pauseBanner"),

    scoreValue: document.getElementById("scoreValue"),
    linesValue: document.getElementById("linesValue"),
    piecesValue: document.getElementById("piecesValue"),
    levelValue: document.getElementById("levelValue"),
    pauseBtn: document.getElementById("pauseBtn"),
    restartBtn: document.getElementById("restartBtn"),
    speedButtons: Array.from(document.querySelectorAll("[data-speed]")),

    decisionSeq: document.getElementById("decisionSeq"),
    decisionEmpty: document.getElementById("decisionEmpty"),
    decisionThinking: document.getElementById("decisionThinking"),
    decisionLive: document.getElementById("decisionLive"),
    decisionEmptyText: document.querySelector("#decisionEmpty p"),
    choiceKey: document.getElementById("choiceKey"),
    choiceTitle: document.getElementById("choiceTitle"),
    choiceSub: document.getElementById("choiceSub"),
    confidenceValue: document.getElementById("confidenceValue"),
    confidenceBar: document.getElementById("confidenceBar"),
    safetyValue: document.getElementById("safetyValue"),
    safetyBar: document.getElementById("safetyBar"),
    safetyLabel: document.getElementById("safetyLabel"),
    urgencyValue: document.getElementById("urgencyValue"),
    urgencyBar: document.getElementById("urgencyBar"),
    urgencyLabel: document.getElementById("urgencyLabel"),
    agreementBadge: document.getElementById("agreementBadge"),
    decisionNote: document.getElementById("decisionNote"),
    candidateCount: document.getElementById("candidateCount"),
    candidateList: document.getElementById("candidateList"),

    traceStatus: document.getElementById("traceStatus"),
    traceStatusText: document.getElementById("traceStatusText"),
    requestMeta: document.getElementById("requestMeta"),
    responseMeta: document.getElementById("responseMeta"),
    requestPane: document.getElementById("requestPane"),
    responsePane: document.getElementById("responsePane"),
    copyRequest: document.querySelector('[data-copy="request"]'),
    copyResponse: document.querySelector('[data-copy="response"]'),
    historyCount: document.getElementById("historyCount"),
    historyList: document.getElementById("historyList"),

    toastStack: document.getElementById("toastStack"),
  };

  const boardCtx = dom.boardCanvas.getContext("2d");
  const nextCtx = dom.nextCanvas.getContext("2d");

  const state = {
    board: E.createBoard(),
    queue: [],
    active: null,
    visual: null,
    flashRows: [],
    running: false,
    auto: false,
    waiting: false,
    applying: false,
    speed: "normal",
    seq: 0,
    session: 0,
    score: 0,
    lines: 0,
    level: 1,
    pieces: 0,
    candidates: [],
    heuristicBest: null,
    selectedLogId: null,
    logs: [],
    totals: { calls: 0, inputTokens: 0, outputTokens: 0 },
    controller: null,
    errorToastShown: false,
    health: null,
    waitFallFrame: 0,
    waitFallToken: 0,
    naturalLanded: false,
    naturalLandingY: null,
  };

  setupCanvas(dom.boardCanvas, boardCtx, BOARD_W, BOARD_H);
  setupCanvas(dom.nextCanvas, nextCtx, NEXT_W, NEXT_H);

  function setupCanvas(canvas, ctx, width, height) {
    canvas.width = Math.round(width * DPR);
    canvas.height = Math.round(height * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  function setStatus(text, tone) {
    dom.gameStatusText.textContent = text;
    const dot = dom.gameStatus.querySelector(".status-dot");
    if (dot) dot.className = `status-dot ${tone || "idle"}`;
  }

  function setServerState(text, tone) {
    dom.serverStatus.textContent = text;
    const dot = dom.serverPill.querySelector(".status-dot");
    if (dot) dot.className = `status-dot ${tone || "idle"}`;
  }

  function setTraceState(text, tone) {
    dom.traceStatusText.textContent = text;
    const dot = dom.traceStatus.querySelector(".status-dot");
    if (dot) dot.className = `status-dot ${tone || "idle"}`;
  }

  function formatNumber(value) {
    return numberFormat.format(Number(value) || 0);
  }

  function usageTokens(usage) {
    if (!usage) return 0;
    return (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
  }

  function addUsage(usage) {
    state.totals.inputTokens += Number(usage && usage.input_tokens) || 0;
    state.totals.outputTokens += Number(usage && usage.output_tokens) || 0;
    updateStatsUI();
  }

  function updateStatsUI() {
    dom.scoreValue.textContent = formatNumber(state.score);
    dom.linesValue.textContent = formatNumber(state.lines);
    dom.piecesValue.textContent = formatNumber(state.pieces);
    dom.levelValue.textContent = String(state.level);
    dom.topCalls.textContent = formatNumber(state.totals.calls);
    dom.topTokens.textContent = formatNumber(
      state.totals.inputTokens + state.totals.outputTokens
    );
  }

  /* ------------------------------------------------------------------ */
  /* Canvas                                                              */
  /* ------------------------------------------------------------------ */

  function shade(hex, percent) {
    const value = parseInt(hex.slice(1), 16);
    const amount = Math.round(2.55 * percent);
    const r = Math.max(0, Math.min(255, (value >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((value >> 8) & 0xff) + amount));
    const b = Math.max(0, Math.min(255, (value & 0xff) + amount));
    return `rgb(${r},${g},${b})`;
  }

  function rgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${value >> 16},${(value >> 8) & 0xff},${value & 0xff},${alpha})`;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawBlock(ctx, x, y, size, color, options) {
    const opts = options || {};
    const pad = size > 20 ? 1.35 : 0.8;
    const bx = x + pad;
    const by = y + pad;
    const bw = size - pad * 2;
    const bh = size - pad * 2;

    if (opts.ghost) {
      roundedRect(ctx, bx, by, bw, bh, Math.max(2, size * 0.12));
      ctx.fillStyle = rgba(color, 0.08);
      ctx.fill();
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = rgba(color, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    if (opts.active) {
      ctx.shadowColor = rgba(color, 0.55);
      ctx.shadowBlur = 12;
    }
    const gradient = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    gradient.addColorStop(0, shade(color, 30));
    gradient.addColorStop(0.52, color);
    gradient.addColorStop(1, shade(color, -26));
    roundedRect(ctx, bx, by, bw, bh, Math.max(2, size * 0.12));
    ctx.fillStyle = gradient;
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,255,255,0.23)";
    ctx.fillRect(bx + 2.5, by + 2.5, Math.max(0, bw - 5), 1.5);
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1;
    roundedRect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, Math.max(2, size * 0.12));
    ctx.stroke();
    ctx.restore();
  }

  function drawBoard() {
    const ctx = boardCtx;
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    const background = ctx.createLinearGradient(0, 0, 0, BOARD_H);
    background.addColorStop(0, "#07111f");
    background.addColorStop(0.55, "#050c16");
    background.addColorStop(1, "#03070d");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    ctx.strokeStyle = "rgba(102, 170, 220, 0.065)";
    ctx.lineWidth = 1;
    for (let c = 1; c < E.COLS; c += 1) {
      ctx.beginPath();
      ctx.moveTo(c * CELL + 0.5, 0);
      ctx.lineTo(c * CELL + 0.5, BOARD_H);
      ctx.stroke();
    }
    for (let r = 1; r < E.ROWS; r += 1) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL + 0.5);
      ctx.lineTo(BOARD_W, r * CELL + 0.5);
      ctx.stroke();
    }

    const heights = E.columnHeights(state.board);
    const maxHeight = Math.max.apply(null, heights);
    if (maxHeight >= 12) {
      const danger = ctx.createLinearGradient(0, 0, 0, BOARD_H * 0.3);
      danger.addColorStop(0, "rgba(255, 91, 122, 0.11)");
      danger.addColorStop(1, "rgba(255, 91, 122, 0)");
      ctx.fillStyle = danger;
      ctx.fillRect(0, 0, BOARD_W, BOARD_H * 0.3);
    }

    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.beginPath();
    ctx.moveTo(0, 4 * CELL + 0.5);
    ctx.lineTo(BOARD_W, 4 * CELL + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let r = 0; r < E.ROWS; r += 1) {
      for (let c = 0; c < E.COLS; c += 1) {
        const cell = state.board[r][c];
        if (cell) {
          drawBlock(ctx, c * CELL, r * CELL, CELL, E.COLORS[cell] || "#8ea8bf", {
            alpha: 0.95,
          });
        }
      }
    }

    if (state.flashRows.length) {
      state.flashRows.forEach((row) => {
        ctx.fillStyle = "rgba(222, 249, 255, 0.72)";
        ctx.fillRect(0, row * CELL, BOARD_W, CELL);
        ctx.fillStyle = "rgba(87, 227, 255, 0.35)";
        ctx.fillRect(0, row * CELL + CELL / 2 - 1, BOARD_W, 2);
      });
    }

    const visual = state.visual;
    const active = state.active;
    const matrix = visual ? visual.matrix : active ? active.matrix : null;
    if (!matrix) return;

    const type = visual ? visual.type : active.type;
    const color = E.COLORS[type] || "#8ea8bf";
    const x = visual ? visual.x : active.x;
    const y = visual ? visual.y : active.y;
    const ghostX = visual ? visual.targetX : active.x;
    const ghostY = visual
      ? visual.targetY
      : E.landingRow(state.board, matrix, active.x);

    if (ghostY != null) {
      E.matrixCells(matrix, ghostX, ghostY).forEach(([cellX, cellY]) => {
        if (cellY >= 0 && cellY < E.ROWS && cellX >= 0 && cellX < E.COLS) {
          drawBlock(ctx, cellX * CELL, cellY * CELL, CELL, color, { ghost: true });
        }
      });
    }

    E.matrixCells(matrix, x, y).forEach(([cellX, cellY]) => {
      if (cellY >= -1 && cellY < E.ROWS && cellX >= 0 && cellX < E.COLS) {
        drawBlock(ctx, cellX * CELL, cellY * CELL, CELL, color, { active: true });
      }
    });
  }

  function drawMiniBlock(ctx, x, y, size, color) {
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, shade(color, 28));
    gradient.addColorStop(1, shade(color, -22));
    roundedRect(ctx, x + 0.7, y + 0.7, size - 1.4, size - 1.4, 3);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawNext() {
    const ctx = nextCtx;
    ctx.clearRect(0, 0, NEXT_W, NEXT_H);

    const background = ctx.createLinearGradient(0, 0, 0, NEXT_H);
    background.addColorStop(0, "rgba(8, 18, 32, 0.95)");
    background.addColorStop(1, "rgba(3, 8, 14, 0.95)");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, NEXT_W, NEXT_H);

    const upcoming = state.queue.slice(0, 3);
    for (let i = 0; i < 3; i += 1) {
      const top = i * NEXT_SLOT;
      if (i > 0) {
        ctx.strokeStyle = "rgba(117, 170, 208, 0.12)";
        ctx.beginPath();
        ctx.moveTo(10, top + 0.5);
        ctx.lineTo(NEXT_W - 10, top + 0.5);
        ctx.stroke();
      }

      const type = upcoming[i];
      if (!type) {
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = "rgba(128, 158, 182, 0.18)";
        roundedRect(ctx, NEXT_W / 2 - 14, top + NEXT_SLOT / 2 - 14, 28, 28, 5);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      const matrix = E.SHAPES[type][0].matrix;
      const cell = 14;
      const width = matrix[0].length * cell;
      const height = matrix.length * cell;
      const startX = Math.round((NEXT_W - width) / 2);
      const startY = Math.round(top + (NEXT_SLOT - height) / 2);
      const color = E.COLORS[type];

      for (let r = 0; r < matrix.length; r += 1) {
        for (let c = 0; c < matrix[r].length; c += 1) {
          if (matrix[r][c]) {
            drawMiniBlock(ctx, startX + c * cell, startY + r * cell, cell, color);
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Game lifecycle                                                      */
  /* ------------------------------------------------------------------ */

  function fillQueue() {
    while (state.queue.length < 5) {
      const bag = E.makeBag();
      state.queue.push.apply(state.queue, bag);
    }
  }

  function beginNewGame() {
    const session = state.session + 1;
    state.session = session;
    stopWaitingFall();

    if (state.controller) {
      try {
        state.controller.abort();
      } catch (error) {
        // Nothing to clean up if the request already finished.
      }
      state.controller = null;
    }

    state.running = true;
    state.auto = true;
    state.waiting = false;
    state.applying = false;
    state.seq = 0;
    state.board = E.createBoard();
    state.queue = [];
    state.active = null;
    state.visual = null;
    state.flashRows = [];
    state.naturalLanded = false;
    state.naturalLandingY = null;
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.pieces = 0;
    state.candidates = [];
    state.heuristicBest = null;
    state.selectedLogId = null;
    state.logs = [];
    state.totals = { calls: 0, inputTokens: 0, outputTokens: 0 };
    state.errorToastShown = false;

    dom.startOverlay.classList.add("hidden");
    dom.gameOverOverlay.classList.add("hidden");
    dom.pauseBanner.classList.add("hidden");
    dom.pauseBtn.disabled = false;
    dom.pauseBtn.textContent = "暂停";
    if (typeof dom.startBtn.blur === "function") dom.startBtn.blur();
    if (typeof dom.restartOverlayBtn.blur === "function") {
      dom.restartOverlayBtn.blur();
    }

    showDecisionEmpty(DEFAULT_DECISION_EMPTY);
    renderCandidates(null, null, false, false);
    renderHistory();
    renderTrace();
    updateStatsUI();
    setStatus("准备开局", "busy");
    setTraceState("IDLE", "idle");

    fillQueue();
    spawnNext(session);
  }

  function spawnNext(session) {
    if (session !== state.session || !state.running) return;

    stopWaitingFall();
    fillQueue();
    const type = state.queue.shift();
    const active = E.spawnPiece(state.board, type);
    if (!active) {
      endGame("出生位置被占用，堆叠已经到达顶部。");
      return;
    }

    state.active = active;
    state.visual = null;
    state.flashRows = [];
    state.naturalLanded = false;
    state.naturalLandingY = null;
    state.candidates = [];
    state.heuristicBest = null;
    state.applying = false;

    drawBoard();
    drawNext();
    updateStatsUI();

    if (state.auto) {
      setStatus("Jev 决策中", "busy");
      beginTurn(session);
    } else {
      enterPausedState();
    }
  }

  async function beginTurn(sessionArg) {
    const session = sessionArg == null ? state.session : sessionArg;
    if (
      session !== state.session ||
      !state.running ||
      !state.auto ||
      state.waiting ||
      state.applying ||
      !state.active
    ) {
      return;
    }

    const analysis = E.findShortlist(state.board, state.active.type);
    state.candidates = analysis.shortlist;
    state.heuristicBest = analysis.heuristicBest;

    if (!state.candidates.length) {
      endGame("当前方块没有任何合法落点。");
      return;
    }

    state.seq += 1;
    const seq = state.seq;
    const localPayload = buildLocalPayload(seq);
    const entry = {
      seq,
      piece: state.active.type,
      candidateCount: state.candidates.length,
      status: "pending",
      startedAt: performance.now(),
      elapsed: null,
      request: null,
      response: null,
      result: null,
      error: null,
      errorPayload: null,
      local: localPayload,
      callsCounted: false,
    };

    state.logs.unshift(entry);
    if (state.logs.length > LOG_LIMIT) state.logs.length = LOG_LIMIT;
    state.selectedLogId = seq;
    state.waiting = true;
    startWaitingFall(session);

    const controller = new AbortController();
    state.controller = controller;

    showThinking(seq);
    renderCandidates(null, null, false, false);
    renderHistory();
    renderTrace();
    setStatus("Jev 决策中", "busy");
    setTraceState("STREAMING", "busy");

    try {
      const response = await fetch("/api/decide", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(localPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let payload = null;
        try {
          payload = await response.json();
        } catch (error) {
          payload = null;
        }
        const message = payload
          ? [payload.error, payload.detail].filter(Boolean).join(": ")
          : `HTTP ${response.status}`;
        const requestError = new Error(message || `HTTP ${response.status}`);
        requestError.payload = payload;
        throw requestError;
      }

      const data = await consumeDecisionStream(response, session, entry, seq);
      if (session !== state.session) return;

      stopWaitingFall();
      state.waiting = false;
      if (state.controller === controller) state.controller = null;

      const landedNaturally = state.naturalLanded;
      entry.status = "ok";
      entry.result = data;
      entry.response = data.response;
      entry.elapsed = data.latency_ms;
      entry.naturalLanded = landedNaturally;
      if (!entry.callsCounted) {
        entry.callsCounted = true;
        state.totals.calls += 1;
      }
      addUsage(data.usage);

      renderHistory();
      if (state.selectedLogId === seq) renderTrace();
      setTraceState("LIVE", "live");
      setServerState("JEV READY", "live");

      renderDecision(data);
      renderCandidates(
        data.candidate_index,
        data.heuristic_best ? data.heuristic_best.candidate_index : null,
        true,
        Boolean(data.fallback_reason)
      );
      if (landedNaturally) markDecisionNatural();

      state.applying = true;
      if (landedNaturally) {
        if (!state.active) {
          endGame("方块已经落地，但活动方块状态丢失。");
          return;
        }
        setStatus("自然落点锁定", "busy");
        const natural = naturalCandidate(state.active, state.naturalLandingY);
        await playCandidate(natural, session, { instant: true });
      } else {
        const candidate = state.candidates[data.candidate_index];
        if (!candidate) {
          endGame("服务端返回了无法映射的候选落点。");
          return;
        }
        setStatus("落子中", "busy");
        await playCandidate(candidate, session);
      }
      if (session !== state.session) return;
      spawnNext(session);
    } catch (error) {
      if (session !== state.session) return;
      if (error && error.name === "AbortError") return;

      stopWaitingFall();
      state.waiting = false;
      if (state.controller === controller) state.controller = null;

      entry.status = "error";
      entry.error = formatError(error);
      entry.elapsed = Math.round(performance.now() - entry.startedAt);
      if (error && error.streamEvent) entry.errorPayload = error.streamEvent;
      else if (error && error.payload) entry.errorPayload = error.payload;

      renderHistory();
      if (state.selectedLogId === seq) renderTrace();
      setTraceState("ERROR", "error");

      await fallbackAfterError(error, entry, session);
    }
  }

  async function consumeDecisionStream(response, session, entry, seq) {
    if (!response.body) throw new Error("当前浏览器不支持流式响应。");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = null;
    let streamError = null;

    const handleLine = (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        throw new Error("收到无法解析的流式事件。");
      }

      if (session !== state.session) return;
      if (event.seq != null && event.seq !== seq) return;

      if (event.type === "request") {
        entry.request = event.payload;
        entry.status = "streaming";
        if (!entry.callsCounted) {
          entry.callsCounted = true;
          state.totals.calls += 1;
          updateStatsUI();
        }
        if (state.selectedLogId === seq) renderTrace();
        renderHistory();
      } else if (event.type === "result") {
        result = event.data;
        entry.result = event.data;
        entry.response = event.data.response;
        entry.status = "result";
        if (state.selectedLogId === seq) renderTrace();
        renderHistory();
      } else if (event.type === "error") {
        streamError = event;
        entry.errorPayload = event;
        entry.status = "error";
        entry.error = formatStreamError(event);
        if (state.selectedLogId === seq) renderTrace();
        renderHistory();
      }
    };

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);

    if (session !== state.session) {
      const stale = new Error("stale stream");
      stale.name = "AbortError";
      throw stale;
    }
    if (streamError) {
      const streamFailure = new Error(entry.error || "Jev API error");
      streamFailure.streamEvent = streamError;
      throw streamFailure;
    }
    if (!result) throw new Error("Jev 流已结束，但没有返回结果。");
    return result;
  }

  function naturalCandidate(active, landingY) {
    const mergedBoard = E.cloneBoard(state.board);
    E.matrixCells(active.matrix, active.x, landingY).forEach(([x, y]) => {
      if (y >= 0 && y < E.ROWS && x >= 0 && x < E.COLS) {
        mergedBoard[y][x] = active.type;
      }
    });
    const cleared = E.clearRows(mergedBoard);
    const heights = E.columnHeights(cleared.board);

    return {
      type: active.type,
      rotation: active.rotation,
      column: active.x,
      row: landingY,
      matrix: active.matrix,
      mergedBoard,
      board: cleared.board,
      clearedRows: cleared.clearedRows,
      linesCleared: cleared.count,
      holes: E.countHoles(cleared.board),
      aggregateHeight: heights.reduce((sum, height) => sum + height, 0),
      maxHeight: Math.max.apply(null, heights),
      natural: true,
    };
  }

  function markDecisionNatural() {
    dom.agreementBadge.className = "agreement warn";
    dom.agreementBadge.textContent = "方块已自然落地 · 本次选择未应用";
    dom.decisionNote.textContent =
      "方块在 Jev 返回前已经接触堆叠，按自然落点锁定；本次选择仅用于观察。";
  }

  function renderDecisionNatural(entry, candidate) {
    renderDecisionFallback(entry, candidate);
    dom.choiceKey.textContent = "自然";
    dom.choiceTitle.textContent =
      `旋转 ${candidate.rotation * 90}° · 第 ${candidate.column} 列`;
    dom.choiceSub.textContent =
      `已接触堆叠 · 消 ${candidate.linesCleared} 行 · 洞 ${candidate.holes}`;
    dom.safetyLabel.textContent = "无 API 信号";
    dom.urgencyLabel.textContent = "自然落地";
    dom.agreementBadge.className = "agreement warn";
    dom.agreementBadge.textContent = "方块已自然落地";
    dom.decisionNote.textContent =
      "方块在 Jev 返回前已经接触堆叠，按自然落点锁定，不受失败的请求影响。";
  }

  async function fallbackAfterError(error, entry, session) {
    if (session !== state.session) return;

    const landedNaturally = Boolean(state.naturalLanded && state.active);
    const candidate = landedNaturally
      ? naturalCandidate(state.active, state.naturalLandingY)
      : state.heuristicBest || state.candidates[0];
    if (!candidate) {
      endGame("Jev 调用失败，且没有可用的兜底落点。");
      return;
    }

    const index = landedNaturally ? -1 : findCandidateIndex(candidate);
    entry.naturalLanded = landedNaturally;

    setStatus(
      landedNaturally ? "API 异常 · 保持自然落点" : "API 异常 · 启发式兜底",
      "warn"
    );
    setTraceState("ERROR", "error");
    if (landedNaturally) {
      renderDecisionNatural(entry, candidate);
      renderCandidates(null, null, false, false);
    } else {
      renderDecisionFallback(entry, candidate);
      renderCandidates(index, index, true, true);
    }
    renderHistory();

    if (!state.errorToastShown) {
      state.errorToastShown = true;
      showToast(
        landedNaturally
          ? "Jev 请求失败；方块已自然落地，保持当前落点。"
          : "Jev 请求失败，已改用启发式最优落点继续。详情见实时响应。",
        "error"
      );
    }

    await sleep(160);
    if (session !== state.session) return;

    state.applying = true;
    await playCandidate(candidate, session, { instant: landedNaturally });
    if (session !== state.session) return;
    spawnNext(session);
  }

  async function playCandidate(candidate, session, options) {
    if (!state.active) return;

    const instant = Boolean(options && options.instant);
    setStatus(
      candidate.linesCleared > 0
        ? `消除 ${candidate.linesCleared} 行`
        : "落子中",
      "busy"
    );

    if (instant) {
      state.visual = {
        type: state.active.type,
        matrix: candidate.matrix,
        x: candidate.column,
        y: candidate.row,
        targetX: candidate.column,
        targetY: candidate.row,
      };
      drawBoard();
    } else {
      await animateDrop(candidate, session);
      if (session !== state.session) return;
    }

    state.active = null;
    state.visual = null;
    state.board = E.cloneBoard(candidate.mergedBoard);
    state.flashRows = candidate.clearedRows.slice();
    drawBoard();

    if (state.flashRows.length) {
      await sleep(state.speed === "fast" ? 50 : 210);
      if (session !== state.session) return;
    }

    state.flashRows = [];
    state.board = E.cloneBoard(candidate.board);

    const level = state.level;
    state.score += (LINE_SCORES[candidate.linesCleared] || 0) * level;
    state.lines += candidate.linesCleared;
    state.level = Math.floor(state.lines / 10) + 1;
    state.pieces += 1;

    drawBoard();
    drawNext();
    updateStatsUI();

    await sleep(state.speed === "fast" ? 20 : 110);
  }

  /* While the request is in flight the piece keeps falling in its current
     column. This is purely visual: state.board and the candidate list sent to
     Jev stay frozen, so the returned placement remains valid. */
  function stopWaitingFall() {
    state.waitFallToken += 1;
    if (state.waitFallFrame) {
      cancelAnimationFrame(state.waitFallFrame);
      state.waitFallFrame = 0;
    }
  }

  function startWaitingFall(session) {
    stopWaitingFall();
    if (!state.active || state.applying) return;

    const active = state.active;
    const startX = active.x;
    const startY = active.y;
    const targetY = E.landingRow(state.board, active.matrix, startX);
    if (targetY == null) return;
    if (targetY <= startY) {
      state.naturalLanded = true;
      state.naturalLandingY = targetY;
      return;
    }

    const token = ++state.waitFallToken;
    const startedAt = performance.now();
    const duration = Math.max(
      WAIT_FALL_MIN_MS,
      (targetY - startY) * WAIT_FALL_MS_PER_ROW
    );

    state.visual = {
      type: active.type,
      matrix: active.matrix,
      x: startX,
      y: startY,
      targetX: startX,
      targetY,
    };

    const halted = () =>
      token !== state.waitFallToken ||
      session !== state.session ||
      !state.running ||
      !state.waiting ||
      !state.active;

    const frame = (now) => {
      if (halted()) return;

      const progress = Math.min(1, (now - startedAt) / duration);
      state.visual.y = startY + (targetY - startY) * progress;
      drawBoard();

      if (progress < 1) {
        state.waitFallFrame = requestAnimationFrame(frame);
        return;
      }

      // The piece has touched down. Its landing is now final; a late Jev
      // response will be displayed but will not move it.
      state.waitFallFrame = 0;
      state.naturalLanded = true;
      state.naturalLandingY = targetY;
      state.visual.y = targetY;
      drawBoard();
      if (state.running && state.waiting) {
        setStatus("已自然落地 · 等待 Jev", "warn");
      }
    };

    state.waitFallFrame = requestAnimationFrame(frame);
  }

  function animateDrop(candidate, session) {
    return new Promise((resolve) => {
      if (!state.active) {
        resolve();
        return;
      }

      const active = state.active;
      const from =
        state.visual && state.visual.type === active.type
          ? state.visual
          : null;
      const startX = from ? from.x : active.x;
      const startY = from ? from.y : active.y;

      state.visual = {
        type: active.type,
        matrix: candidate.matrix,
        x: startX,
        y: startY,
        targetX: candidate.column,
        targetY: candidate.row,
      };

      const duration = state.speed === "fast" ? 0 : 620;
      if (!duration) {
        state.visual.x = candidate.column;
        state.visual.y = candidate.row;
        drawBoard();
        resolve();
        return;
      }

      const startedAt = performance.now();

      const frame = (now) => {
        if (session !== state.session) {
          resolve();
          return;
        }

        const progress = Math.min(1, (now - startedAt) / duration);
        const horizontal = Math.min(1, progress * 3);
        const vertical = progress * progress;

        state.visual.x = startX + (candidate.column - startX) * horizontal;
        state.visual.y = startY + (candidate.row - startY) * vertical;
        drawBoard();

        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };

      requestAnimationFrame(frame);
    });
  }

  function enterPausedState() {
    state.auto = false;
    dom.pauseBanner.classList.remove("hidden");
    dom.pauseBtn.textContent = "继续";
    dom.pauseBtn.disabled = false;
    setStatus("已暂停", "idle");
    setTraceState("HOLD", "idle");
    showDecisionEmpty("已暂停。点击「继续」会为下一块请求 Jev。");
    renderCandidates(null, null, false, false);
  }

  function togglePause() {
    if (!state.running) return;

    if (state.auto) {
      state.auto = false;
      dom.pauseBtn.textContent = "继续";
      if (state.waiting || state.applying) {
        setStatus("本步完成后暂停", "warn");
      } else {
        enterPausedState();
      }
      return;
    }

    state.auto = true;
    dom.pauseBtn.textContent = "暂停";
    dom.pauseBanner.classList.add("hidden");

    if (state.waiting) {
      setStatus("Jev 决策中", "busy");
      setTraceState("STREAMING", "busy");
    } else if (state.applying) {
      setStatus("落子中", "busy");
      setTraceState("LIVE", "live");
    } else if (state.active) {
      beginTurn(state.session);
    }
  }

  function endGame(reason) {
    stopWaitingFall();
    state.running = false;
    state.auto = false;
    state.waiting = false;
    state.applying = false;

    dom.pauseBtn.disabled = true;
    dom.pauseBtn.textContent = "暂停";
    dom.pauseBanner.classList.add("hidden");

    dom.gameOverReason.textContent = reason || "这一局结束了。";
    dom.finalScore.textContent = formatNumber(state.score);
    dom.finalLines.textContent = formatNumber(state.lines);
    dom.finalCalls.textContent = formatNumber(state.totals.calls);
    dom.gameOverOverlay.classList.remove("hidden");

    setStatus("游戏结束", "warn");
    setTraceState("IDLE", "idle");
  }

  function findCandidateIndex(candidate) {
    if (!candidate) return -1;
    return state.candidates.findIndex(
      (item) =>
        item.rotation === candidate.rotation &&
        item.column === candidate.column &&
        item.row === candidate.row
    );
  }

  function buildLocalPayload(seq) {
    return {
      seq,
      board: E.boardToLines(state.board),
      active: state.active.type,
      next: state.queue.slice(0, 3),
      stats: {
        score: state.score,
        lines: state.lines,
        pieces: state.pieces,
      },
      candidates: state.candidates.map((candidate) => ({
        rotation: candidate.rotation,
        column: candidate.column,
        row: candidate.row,
        lines_cleared: candidate.linesCleared,
        holes: candidate.holes,
        holes_added: candidate.holesAdded,
        aggregate_height: candidate.aggregateHeight,
        max_height: candidate.maxHeight,
        bumpiness: candidate.bumpiness,
        wells: candidate.wells,
        landing_height: candidate.landingHeight,
        heuristic: candidate.heuristic,
      })),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Decision UI                                                         */
  /* ------------------------------------------------------------------ */

  function percent(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
  }

  function barTone(value, medium, high) {
    if (value >= high) return "var(--green)";
    if (value >= medium) return "var(--amber)";
    return "var(--red)";
  }

  function showThinking(seq) {
    dom.decisionEmpty.classList.add("hidden");
    dom.decisionLive.classList.add("hidden");
    dom.decisionThinking.classList.remove("hidden");
    dom.decisionSeq.textContent = `#${seq}`;
  }

  function showDecisionEmpty(message) {
    dom.decisionThinking.classList.add("hidden");
    dom.decisionLive.classList.add("hidden");
    dom.decisionEmpty.classList.remove("hidden");
    dom.decisionEmptyText.textContent = message || DEFAULT_DECISION_EMPTY;
    dom.decisionSeq.textContent = "#—";
  }

  function renderDecision(data) {
    const candidate = state.candidates[data.candidate_index];
    if (!candidate) {
      showThinking(data.seq);
      return;
    }

    const safety = data.safe || {};
    const urgency = data.urgency || {};
    const safetyProbability = Number(safety.probability);
    const urgencyScore = Number(urgency.score);
    const confidence = Number(data.confidence);

    dom.decisionEmpty.classList.add("hidden");
    dom.decisionThinking.classList.add("hidden");
    dom.decisionLive.classList.remove("hidden");
    dom.decisionSeq.textContent = `#${data.seq}`;

    dom.choiceKey.textContent = data.choice;
    dom.choiceTitle.textContent = `旋转 ${candidate.rotation * 90}° · 第 ${candidate.column} 列`;
    dom.choiceSub.textContent =
      `消 ${candidate.linesCleared} 行 · 洞 ${candidate.holes} · 总高 ${candidate.aggregateHeight}`;

    dom.confidenceValue.textContent = percent(confidence);
    dom.confidenceBar.style.width = `${Math.max(2, confidence * 100)}%`;

    dom.safetyValue.textContent = Number.isFinite(safetyProbability)
      ? percent(safetyProbability)
      : "—";
    dom.safetyBar.style.width = Number.isFinite(safetyProbability)
      ? `${Math.max(2, safetyProbability * 100)}%`
      : "0%";
    dom.safetyBar.style.background = Number.isFinite(safetyProbability)
      ? barTone(safetyProbability, 0.45, 0.7)
      : "var(--muted)";
    dom.safetyLabel.textContent = safety.label || (safety.probability == null ? "无信号" : "");

    dom.urgencyValue.textContent = Number.isFinite(urgencyScore)
      ? `${urgencyScore.toFixed(1)} / 2`
      : "—";
    dom.urgencyBar.style.width = Number.isFinite(urgencyScore)
      ? `${Math.max(2, Math.min(1, urgencyScore / 2) * 100)}%`
      : "0%";
    dom.urgencyBar.style.background = Number.isFinite(urgencyScore)
      ? (urgencyScore >= 1.4
          ? "var(--red)"
          : urgencyScore >= 0.7
            ? "var(--amber)"
            : "var(--green)")
      : "var(--muted)";
    dom.urgencyLabel.textContent = urgency.label || "";

    dom.agreementBadge.className = "agreement";
    if (data.fallback_reason) {
      dom.agreementBadge.classList.add("warn");
      dom.agreementBadge.textContent = `启发式兜底 · ${data.fallback_reason}`;
    } else if (data.agreement_with_heuristic) {
      dom.agreementBadge.classList.add("good");
      dom.agreementBadge.textContent = "与启发式最优一致";
    } else {
      dom.agreementBadge.classList.add("diff");
      const gap = Math.abs(Number(data.heuristic_gap) || 0);
      dom.agreementBadge.textContent = `Jev 另辟蹊径 · 启发式差 ${gap.toFixed(2)}`;
    }

    dom.decisionNote.textContent =
      data.review_note ||
      "候选来自合法落点；Jev 依据棋面与特征指标做出选择，不是随机移动。";
  }

  function renderDecisionFallback(entry, candidate) {
    const index = findCandidateIndex(candidate);

    dom.decisionEmpty.classList.add("hidden");
    dom.decisionThinking.classList.add("hidden");
    dom.decisionLive.classList.remove("hidden");
    dom.decisionSeq.textContent = entry ? `#${entry.seq}` : "#—";

    dom.choiceKey.textContent = index >= 0 ? `c${index + 1}` : "HB";
    dom.choiceTitle.textContent = `旋转 ${candidate.rotation * 90}° · 第 ${candidate.column} 列`;
    dom.choiceSub.textContent =
      `启发式兜底 · 消 ${candidate.linesCleared} 行 · 洞 ${candidate.holes}`;

    dom.confidenceValue.textContent = "—";
    dom.confidenceBar.style.width = "0%";

    dom.safetyValue.textContent = "—";
    dom.safetyBar.style.width = "0%";
    dom.safetyBar.style.background = "var(--muted)";
    dom.safetyLabel.textContent = "没有 API 结果";

    dom.urgencyValue.textContent = "—";
    dom.urgencyBar.style.width = "0%";
    dom.urgencyBar.style.background = "var(--muted)";
    dom.urgencyLabel.textContent = "启发式兜底";

    dom.agreementBadge.className = "agreement warn";
    dom.agreementBadge.textContent = "API 失败 · 使用启发式最优落点";
    const note = (entry && entry.error) || "Jev 请求失败，本步已降级到本地启发式。";
    dom.decisionNote.textContent =
      note.length > 220 ? `${note.slice(0, 220)}…` : note;
  }

  function renderCandidates(chosen, best, judged, fallback) {
    const list = dom.candidateList;
    list.innerHTML = "";

    if (!state.candidates.length) {
      const placeholder = document.createElement("div");
      placeholder.className = "candidate-placeholder";
      placeholder.textContent = state.running
        ? "等待当前棋面的候选落点。"
        : "规则引擎会先筛出合法落点。";
      list.appendChild(placeholder);
      dom.candidateCount.textContent = state.running ? "等待决策" : "等待开始";
      return;
    }

    dom.candidateCount.textContent = `${state.candidates.length} 个候选`;
    const fragment = document.createDocumentFragment();
    let chosenRow = null;

    state.candidates.forEach((candidate, index) => {
      const row = document.createElement("div");
      row.className = "candidate-row";
      if (judged) row.classList.add("is-judged");
      if (chosen === index) {
        row.classList.add(fallback ? "is-fallback" : "is-jev");
        chosenRow = row;
      }

      const key = document.createElement("span");
      key.className = "c-key";
      key.textContent = candidate.id || `c${index + 1}`;

      const move = document.createElement("span");
      move.className = "c-move";
      move.textContent = `R${candidate.rotation} / C${candidate.column}`;
      move.title = `旋转 ${candidate.rotation * 90}°，左起第 ${candidate.column} 列`;

      const metrics = document.createElement("span");
      metrics.className = "c-metrics";
      metrics.textContent =
        `洞${candidate.holes} · 高${candidate.maxHeight} · 消${candidate.linesCleared}`;

      const tags = document.createElement("span");
      tags.className = "c-tags";
      if (chosen === index) {
        const chosenTag = document.createElement("span");
        chosenTag.className = fallback ? "tag best-tag fallback-tag" : "tag jev-tag";
        chosenTag.textContent = fallback ? "兜底" : "JEV";
        tags.appendChild(chosenTag);
      }
      if (best === index && !(fallback && chosen === index)) {
        const bestTag = document.createElement("span");
        bestTag.className = "tag best-tag";
        bestTag.textContent = "最优";
        tags.appendChild(bestTag);
      }

      row.appendChild(key);
      row.appendChild(move);
      row.appendChild(metrics);
      row.appendChild(tags);
      fragment.appendChild(row);
    });

    list.appendChild(fragment);

    if (chosenRow) {
      requestAnimationFrame(() => {
        const relativeTop = chosenRow.offsetTop - list.offsetTop;
        const target =
          relativeTop - (list.clientHeight - chosenRow.offsetHeight) / 2;
        list.scrollTop = Math.max(0, target);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Trace and history                                                   */
  /* ------------------------------------------------------------------ */

  function pretty(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  function setPaneText(pane, text) {
    if (pane.dataset.content === text) return;
    pane.dataset.content = text;
    pane.textContent = text;
    pane.scrollTop = 0;
  }

  function selectedLog() {
    if (!state.logs.length) return null;
    return (
      state.logs.find((entry) => entry.seq === state.selectedLogId) || state.logs[0]
    );
  }

  function requestTextFor(entry) {
    if (!entry) return "";
    if (entry.request) return pretty(entry.request);
    if (entry.error || entry.status === "error") return pretty(entry.local);
    return "";
  }

  function responseTextFor(entry) {
    if (!entry) return "";
    if (entry.response) return pretty(entry.response);
    if (entry.errorPayload) return pretty(entry.errorPayload);
    if (entry.error) return entry.error;
    return "";
  }

  function renderTrace() {
    const entry = selectedLog();
    const requestText = requestTextFor(entry);
    const responseText = responseTextFor(entry);

    dom.copyRequest.disabled = !requestText;
    dom.copyResponse.disabled = !responseText;

    if (!entry) {
      setPaneText(
        dom.requestPane,
        "等待第一次决策。\n\n请求参数会在这里实时出现，随后收到 Jev 的原始响应。"
      );
      setPaneText(dom.responsePane, "等待 Jev 返回。");
      dom.responsePane.classList.remove("waiting");
      dom.requestMeta.textContent = "request #—";
      dom.responseMeta.textContent = "response #—";
      return;
    }

    if (entry.request) {
      setPaneText(dom.requestPane, requestText);
      dom.requestMeta.textContent =
        `#${entry.seq} · ${entry.piece} · ${entry.candidateCount} candidates`;
    } else if (entry.error || entry.status === "error") {
      setPaneText(dom.requestPane, pretty(entry.local));
      dom.requestMeta.textContent = `#${entry.seq} · 本地请求 / 未收到 Jev payload`;
    } else {
      setPaneText(
        dom.requestPane,
        "正在把本地请求交给服务端组装 Jev payload…\n\n服务端会先校验棋盘与候选，再用同一个流把完整请求发回浏览器。"
      );
      dom.requestMeta.textContent = `#${entry.seq} · ${entry.piece} · 组装中`;
    }

    if (responseText) {
      dom.responsePane.classList.remove("waiting");
      setPaneText(dom.responsePane, responseText);
      if (entry.result) {
        dom.responseMeta.textContent =
          `${entry.result.choice} · ${entry.result.latency_ms} ms · ` +
          `${usageTokens(entry.result.usage)} tok`;
      } else {
        dom.responseMeta.textContent = `#${entry.seq} · ERROR`;
      }
    } else {
      dom.responsePane.classList.add("waiting");
      setPaneText(
        dom.responsePane,
        "Jev 正在推理…\n\n请求参数已经先一步到达浏览器；收到结果后这里会立即更新。"
      );
      dom.responseMeta.textContent = `#${entry.seq} · 等待响应`;
    }
  }

  function renderHistory() {
    dom.historyList.innerHTML = "";
    dom.historyCount.textContent = `${state.logs.length} 次`;

    if (!state.logs.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "还没有调用记录。";
      dom.historyList.appendChild(empty);
      return;
    }

    state.logs.slice(0, HISTORY_LIMIT).forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";
      if (entry.status === "error") button.classList.add("error");
      if (entry.seq === state.selectedLogId) button.classList.add("active");

      const seq = document.createElement("span");
      seq.className = "h-seq";
      seq.textContent = `#${entry.seq}`;

      const name = document.createElement("span");
      name.className = "h-main";
      if (entry.naturalLanded) {
        name.textContent = `${entry.piece} → 自然落地`;
      } else if (entry.result) {
        name.textContent = `${entry.piece} → ${entry.result.choice}`;
      } else if (entry.status === "error") {
        name.textContent = `${entry.piece} → ERROR`;
      } else {
        name.textContent = `${entry.piece} → …`;
      }

      const side = document.createElement("span");
      side.className = "h-side";
      side.textContent = entry.result
        ? `${entry.result.latency_ms} ms`
        : entry.status === "error"
          ? "ERR"
          : "···";

      button.appendChild(seq);
      button.appendChild(name);
      button.appendChild(side);
      button.addEventListener("click", () => {
        state.selectedLogId = entry.seq;
        renderHistory();
        renderTrace();
      });

      dom.historyList.appendChild(button);
    });
  }

  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      showToast("已复制。", "info");
    } catch (error) {
      showToast("复制失败，请手动选择文本。", "error");
    } finally {
      document.body.removeChild(area);
    }
  }

  function copyText(text, button) {
    if (!text) return;

    const done = () => {
      const previous = button.textContent;
      button.textContent = "COPIED";
      setTimeout(() => {
        button.textContent = previous;
      }, 1200);
      showToast("已复制到剪贴板。", "info");
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function showToast(message, tone) {
    const toast = document.createElement("div");
    toast.className = `toast${tone === "error" ? " error" : ""}`;
    toast.textContent = message;
    dom.toastStack.appendChild(toast);

    while (dom.toastStack.children.length > 3) {
      dom.toastStack.removeChild(dom.toastStack.firstChild);
    }

    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4600);
  }

  function formatStreamError(event) {
    const parts = [event && event.error];
    if (event && event.status != null) parts.push(`HTTP ${event.status}`);
    if (event && event.detail) parts.push(event.detail);
    return parts.filter(Boolean).join(" · ") || "Jev API error";
  }

  function formatError(error) {
    if (!error) return "未知错误";
    if (error.streamEvent) return formatStreamError(error.streamEvent);
    return error.message || String(error);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function checkHealth() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.health = data;
      dom.serverPill.title =
        `${data.model || "jev-latest"} · ` +
        `${data.proxy_configured ? "via proxy" : "direct"} · ` +
        `${data.host || "127.0.0.1"}:${data.port || ""}`;

      if (data.key_configured === false) {
        setServerState("KEY MISSING", "warn");
        showToast("服务端没有检测到 TYPESAFE_API_KEY。", "error");
      } else {
        setServerState("JEV READY", "live");
      }
    } catch (error) {
      setServerState("SERVER OFFLINE", "error");
      showToast("无法读取 /api/health，请确认本地服务已启动。", "error");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Events and boot                                                     */
  /* ------------------------------------------------------------------ */

  dom.startBtn.addEventListener("click", beginNewGame);
  dom.restartOverlayBtn.addEventListener("click", beginNewGame);
  dom.restartBtn.addEventListener("click", beginNewGame);
  dom.pauseBtn.addEventListener("click", togglePause);

  dom.speedButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const speed = button.dataset.speed;
      if (speed !== "normal" && speed !== "fast") return;
      state.speed = speed;
      dom.speedButtons.forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    });
  });

  dom.copyRequest.addEventListener("click", () => {
    const entry = selectedLog();
    copyText(requestTextFor(entry), dom.copyRequest);
  });

  dom.copyResponse.addEventListener("click", () => {
    const entry = selectedLog();
    copyText(responseTextFor(entry), dom.copyResponse);
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const tag = target && target.tagName ? target.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      beginNewGame();
    }
  });

  drawBoard();
  drawNext();
  renderCandidates(null, null, false, false);
  renderHistory();
  renderTrace();
  updateStatsUI();
  setStatus("待开始", "idle");
  setTraceState("IDLE", "idle");
  checkHealth();
})();
