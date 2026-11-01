#!/usr/bin/env python3
"""Jev Tetris demo backend.

Browser game -> local Python server -> TypeSafe Jev /v1/systemone.

The browser enumerates legal Tetris placements and sends a shortlist. This
server turns the board and shortlist into a Jev choice question, calls the
API, validates the answer, and returns both the exact request and raw
response for the in-page API inspector.
"""

from __future__ import annotations

import errno
import json
import math
import os
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, request
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"


def load_env_file(path: Path) -> bool:
    """Load KEY=VALUE pairs from a local .env without overriding the shell."""
    if not path.is_file():
        return False
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        print(f"Warning: could not read {path}: {exc}", file=sys.stderr)
        return False

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if not name or not name.replace("_", "").isalnum():
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ.setdefault(name, value)
    return True


ENV_FILE_LOADED = load_env_file(ENV_FILE)

API_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
HOST = (os.environ.get("HOST") or "127.0.0.1").strip()
try:
    PORT = int(os.environ.get("PORT", "8788"))
except ValueError:
    print("PORT 必须是整数，例如 PORT=9001。", file=sys.stderr)
    raise SystemExit(1)

API_KEY = os.environ.get("TYPESAFE_API_KEY", "").strip()

PIECES = set("IJLOSTZ")
BOARD_ROWS = 20
BOARD_COLS = 10
MAX_CANDIDATES = 8
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/engine.js": ("engine.js", "application/javascript; charset=utf-8"),
    "/game.js": ("game.js", "application/javascript; charset=utf-8"),
}
URGENCY_FALLBACK = {
    "0": "常规落子",
    "1": "需要主动管理",
    "2": "接近危险，优先降压",
}


def normalize_proxy(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    return value if "://" in value else f"http://{value}"


def detect_proxy() -> str:
    """Prefer explicit config, then standard proxy envs, then local ClashX."""
    if "TYPESAFE_PROXY" in os.environ:
        return normalize_proxy(os.environ["TYPESAFE_PROXY"])
    for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        value = os.environ.get(name, "")
        if value.strip():
            return normalize_proxy(value)
    try:
        with socket.create_connection(("127.0.0.1", 7890), timeout=0.2):
            return "http://127.0.0.1:7890"
    except OSError:
        return ""


PROXY = detect_proxy()


class JevError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"Jev API HTTP {status}: {detail}")
        self.status = status
        self.detail = detail


def call_jev(payload: dict) -> tuple[dict, int]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "tetris-jev-demo/1.0",
        },
    )
    if PROXY:
        opener = request.build_opener(
            request.ProxyHandler({"http": PROXY, "https": PROXY})
        )
    else:
        opener = request.build_opener(request.ProxyHandler({}))

    started = time.time()
    try:
        with opener.open(req, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:2000]
        raise JevError(exc.code, detail) from exc
    except error.URLError as exc:
        raise JevError(0, f"network error: {exc.reason}") from exc

    latency_ms = int((time.time() - started) * 1000)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise JevError(0, f"invalid JSON from API: {raw[:500]}") from exc
    return data, latency_ms


def as_float(value, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def require_int(obj: dict, name: str, low: int, high: int) -> int:
    value = obj.get(name)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if value < low or value > high:
        raise ValueError(f"{name} out of range")
    return value


def clean_board(raw) -> list[str]:
    if not isinstance(raw, list) or len(raw) != BOARD_ROWS:
        raise ValueError(f"board must contain {BOARD_ROWS} rows")
    rows = []
    allowed = PIECES | {"."}
    for row in raw:
        if not isinstance(row, str) or len(row) != BOARD_COLS:
            raise ValueError(f"each board row must be {BOARD_COLS} characters")
        if any(char not in allowed for char in row):
            raise ValueError("board contains an unknown cell")
        rows.append(row)
    return rows


def clean_candidates(raw) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("candidates must be a non-empty array")
    if len(raw) > MAX_CANDIDATES:
        raise ValueError(f"at most {MAX_CANDIDATES} candidates are allowed")

    candidates = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("each candidate must be an object")
        candidate = {
            "key": f"c{index + 1}",
            "rotation": require_int(item, "rotation", 0, 3),
            "column": require_int(item, "column", 0, BOARD_COLS - 1),
            "row": require_int(item, "row", 0, BOARD_ROWS - 1),
            "lines_cleared": require_int(item, "lines_cleared", 0, 4),
            "holes": require_int(item, "holes", 0, BOARD_ROWS * BOARD_COLS),
            "holes_added": require_int(
                item, "holes_added", 0, BOARD_ROWS * BOARD_COLS
            ),
            "aggregate_height": require_int(item, "aggregate_height", 0, 200),
            "max_height": require_int(item, "max_height", 0, BOARD_ROWS),
            "bumpiness": require_int(item, "bumpiness", 0, 200),
            "wells": require_int(item, "wells", 0, 200),
            "landing_height": require_int(item, "landing_height", 0, BOARD_ROWS),
        }
        heuristic = item.get("heuristic")
        if isinstance(heuristic, bool) or not isinstance(heuristic, (int, float)):
            raise ValueError("heuristic must be a number")
        if not math.isfinite(float(heuristic)):
            raise ValueError("heuristic must be finite")
        candidate["heuristic"] = round(float(heuristic), 2)
        candidates.append(candidate)
    return candidates


def candidate_description(candidate: dict) -> str:
    return (
        f"{candidate['key']}：旋转 {candidate['rotation'] * 90}°，"
        f"落到第 {candidate['column']} 列；"
        f"本次消 {candidate['lines_cleared']} 行，"
        f"落子后洞 {candidate['holes']} 个（新增 {candidate['holes_added']}），"
        f"总高度 {candidate['aggregate_height']}，"
        f"最高列 {candidate['max_height']}，"
        f"凹凸度 {candidate['bumpiness']}，井 {candidate['wells']}"
    )


def build_payload(body: dict) -> tuple[dict, list[dict]]:
    board = clean_board(body.get("board"))
    active = body.get("active")
    if not isinstance(active, str) or active not in PIECES:
        raise ValueError("active must be one of I, J, L, O, S, T, Z")

    next_raw = body.get("next")
    if not isinstance(next_raw, list) or len(next_raw) > 5:
        raise ValueError("next must be an array of at most 5 pieces")
    next_pieces = []
    for piece in next_raw:
        if not isinstance(piece, str) or piece not in PIECES:
            raise ValueError("next contains an unknown piece")
        next_pieces.append(piece)

    stats_raw = body.get("stats") if isinstance(body.get("stats"), dict) else {}
    stats = {
        "score": require_int(stats_raw, "score", 0, 1_000_000_000)
        if "score" in stats_raw
        else 0,
        "lines": require_int(stats_raw, "lines", 0, 1_000_000)
        if "lines" in stats_raw
        else 0,
        "pieces": require_int(stats_raw, "pieces", 0, 1_000_000)
        if "pieces" in stats_raw
        else 0,
    }
    seq = require_int(body, "seq", 0, 1_000_000_000)

    candidates = clean_candidates(body.get("candidates"))
    criteria = {item["key"]: candidate_description(item) for item in candidates}

    payload = {
        "model": MODEL,
        "state": {
            "game": "俄罗斯方块，10 列 × 20 行",
            "goal": "尽可能长时间生存、消行，并保持堆叠平整",
            "board_note": "'.' 为空；每行从左到右是第 0–9 列，顶部是第 0 行",
            "board": board,
            "active_piece": active,
            "next_pieces": next_pieces,
            "stats": stats,
            "turn": seq,
        },
        "questions": {
            "move": {
                "type": "choice",
                "instructions": (
                    "你是俄罗斯方块的落子决策器。根据当前棋盘和候选落点，"
                    "选择最有利于继续生存、消行和保持平整的一步。"
                    "优先避免产生无法消除的洞、避免堆到顶部，其次再考虑消行和高度。"
                    "候选都由规则引擎枚举为合法落点，只能选择 criteria 中的一个键，"
                    "不要选择候选之外的落点。"
                ),
                "criteria": criteria,
            },
            "safe": {
                "type": "noul",
                "instructions": "当前棋盘是否仍然安全，没有进入随时可能封顶的危险区？",
            },
            "urgency": {
                "type": "score",
                "instructions": "当前这一步对消行或降低堆叠的紧急程度如何？",
                "criteria": [
                    "常规落子即可，暂时没有明显风险",
                    "需要主动管理高度或寻找消行机会",
                    "接近封顶，应优先降低堆叠",
                ],
            },
        },
    }
    return payload, candidates


def answer_map(raw: dict) -> dict:
    answers = raw.get("answers")
    return answers if isinstance(answers, dict) else {}


def safe_label(probability: float) -> str:
    if probability >= 0.65:
        return "安全"
    if probability >= 0.35:
        return "需要关注"
    return "危险"


def decide_with_payload(payload: dict, candidates: list[dict], seq: int) -> dict:
    raw, latency_ms = call_jev(payload)
    answers = answer_map(raw)
    move_obj = answers.get("move") if isinstance(answers.get("move"), dict) else {}
    choice = str(move_obj.get("choice", "")).strip()
    candidate_by_key = {item["key"]: item for item in candidates}
    fallback_reason = None

    heuristic_best = max(candidates, key=lambda item: item["heuristic"])
    if choice not in candidate_by_key:
        fallback_reason = (
            f"Jev 返回的候选 {choice!r} 不在候选中，"
            f"已使用启发式最优落点 {heuristic_best['key']}。"
        )
        choice = heuristic_best["key"]

    chosen = candidate_by_key[choice]
    chosen_index = int(choice[1:]) - 1
    confidence = round(clamp(as_float(move_obj.get("confidence")), 0, 1), 3)
    probabilities = move_obj.get("probabilities")
    if not isinstance(probabilities, dict):
        probabilities = {}

    safe_obj = answers.get("safe")
    if not isinstance(safe_obj, dict):
        safe_obj = {}
    safe_probability = round(clamp(as_float(safe_obj.get("noul"), 0.5), 0, 1), 3)

    urgency_obj = answers.get("urgency")
    if not isinstance(urgency_obj, dict):
        urgency_obj = {}
    urgency_score = round(
        clamp(as_float(urgency_obj.get("score")), 0, 2), 2
    )
    legend = urgency_obj.get("legend")
    if not isinstance(legend, dict):
        legend = {}
    legend_key = str(int(round(urgency_score)))
    urgency_label = (
        legend.get(legend_key) or URGENCY_FALLBACK.get(legend_key) or "未知"
    )

    agreement = choice == heuristic_best["key"]
    review_note = None
    if not agreement and chosen["heuristic"] < heuristic_best["heuristic"] - 2:
        review_note = (
            "Jev 的选择与启发式更优解差异较大；本局仍按 Jev 的决策执行，"
            "用于观察模型偏好。"
        )

    return {
        "seq": seq,
        "model": MODEL,
        "choice": choice,
        "candidate_index": chosen_index,
        "selected": chosen,
        "confidence": confidence,
        "probabilities": probabilities,
        "safe": {
            "probability": safe_probability,
            "label": safe_label(safe_probability),
        },
        "urgency": {
            "score": urgency_score,
            "label": str(urgency_label),
        },
        "agreement_with_heuristic": agreement,
        "heuristic_best": {
            "choice": heuristic_best["key"],
            "candidate_index": int(heuristic_best["key"][1:]) - 1,
            "heuristic": heuristic_best["heuristic"],
        },
        "heuristic_gap": round(heuristic_best["heuristic"] - chosen["heuristic"], 2),
        "fallback_reason": fallback_reason,
        "review_note": review_note,
        "latency_ms": latency_ms,
        "usage": raw.get("usage", {}),
        "request": payload,
        "response": raw,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "JevTetrisDemo/1.0"
    protocol_version = "HTTP/1.1"

    def begin_stream(self) -> None:
        """Start an NDJSON stream so the browser can render the request
        before the (slow) Jev call has returned."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def send_stream_event(self, event: dict) -> None:
        data = (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")
        self.wfile.write(f"{len(data):X}\r\n".encode("ascii"))
        self.wfile.write(data)
        self.wfile.write(b"\r\n")
        self.wfile.flush()

    def end_stream(self) -> None:
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, path: str) -> bool:
        entry = STATIC_FILES.get(path)
        if not entry:
            return False
        filename, content_type = entry
        file_path = BASE_DIR / filename
        if not file_path.is_file():
            self.send_json(500, {"error": f"{filename} not found"})
            return True
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
        return True

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            raise ValueError("request body too large")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid JSON body") from exc
        if not isinstance(body, dict):
            raise ValueError("JSON body must be an object")
        return body

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if self.send_static(path):
            return
        if path == "/api/health":
            self.send_json(
                200,
                {
                    "ok": True,
                    "demo": "tetris",
                    "model": MODEL,
                    "key_configured": bool(API_KEY),
                    "env_file_loaded": ENV_FILE_LOADED,
                    "proxy_configured": bool(PROXY),
                    "host": HOST,
                    "port": PORT,
                },
            )
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/api/decide":
            self.send_json(404, {"error": "not found"})
            return
        try:
            body = self.read_json()
            seq = require_int(body, "seq", 0, 1_000_000_000)
            payload, candidates = build_payload(body)
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
            return

        try:
            self.begin_stream()
            self.send_stream_event(
                {"type": "request", "seq": seq, "payload": payload}
            )
            try:
                result = decide_with_payload(payload, candidates, seq)
                self.send_stream_event(
                    {"type": "result", "seq": seq, "data": result}
                )
            except JevError as exc:
                self.send_stream_event(
                    {
                        "type": "error",
                        "seq": seq,
                        "error": "Jev API request failed",
                        "status": exc.status,
                        "detail": exc.detail[:2000],
                    }
                )
            except Exception as exc:  # keep the game responsive on errors
                print(f"[error] {type(exc).__name__}: {exc}", file=sys.stderr)
                self.send_stream_event(
                    {
                        "type": "error",
                        "seq": seq,
                        "error": "internal server error",
                        "detail": f"{type(exc).__name__}: {exc}"[:2000],
                    }
                )
            self.end_stream()
        except (BrokenPipeError, ConnectionResetError):
            print("[warn] browser disconnected during /api/decide", file=sys.stderr)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main() -> None:
    if sys.version_info < (3, 8):
        print("需要 Python 3.8 或更高版本。", file=sys.stderr)
        raise SystemExit(1)
    if not API_KEY:
        print(
            "TYPESAFE_API_KEY 未设置。任选一种方式：\n"
            "  1) cp tetris-demo/env.example tetris-demo/.env 并填写 key\n"
            "  2) export TYPESAFE_API_KEY=\"...\" 后重新启动\n"
            "注意：不要把 .env 提交到仓库。",
            file=sys.stderr,
        )
        raise SystemExit(1)

    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(
                f"端口 {PORT} 已被占用。先停止旧实例，或换一个端口：\n"
                f"  PORT={PORT + 1} bash tetris-demo/start.sh",
                file=sys.stderr,
            )
            raise SystemExit(1) from exc
        raise

    print(f"Jev Tetris demo: http://{HOST}:{PORT}")
    print(f"Jev model: {MODEL}")
    print(f"Env file: {ENV_FILE if ENV_FILE_LOADED else '(not found)'}")
    print(f"Proxy: {PROXY or '(direct)'}")
    if PROXY:
        print("  override with TYPESAFE_PROXY=\"\" to disable the proxy")
    if HOST not in ("127.0.0.1", "localhost", "::1"):
        print(
            f"Warning: HOST={HOST} exposes this unauthenticated demo beyond "
            "this machine. Only use it on a trusted network.",
            file=sys.stderr,
        )
    print(f"Health check: http://127.0.0.1:{PORT}/api/health")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
