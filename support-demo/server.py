#!/usr/bin/env python3
"""Sleep-bracelet support triage demo.

Browser chat UI -> local server -> TypeSafe Jev /v1/systemone.

The API key stays in the server process; it is never sent to the browser.
Run with:

    source ~/.bash_profile
    python3 support-demo/server.py

Then open http://127.0.0.1:8787
"""

from __future__ import annotations

import errno
import json
import os
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, request

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR.parent / ".env"  # 共享 key 文件在仓库根目录


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

API_URL = (
    os.environ.get("JEV_API_URL") or "https://api.jevgo.cn/v1/systemone"
).strip()
MODEL = "jev-latest"
HOST = (os.environ.get("HOST") or "127.0.0.1").strip()
try:
    PORT = int(os.environ.get("PORT", "8787"))
except ValueError:
    print("PORT 必须是整数，例如 PORT=9000。", file=sys.stderr)
    raise SystemExit(1)

API_KEY = os.environ.get("TYPESAFE_API_KEY", "").strip()


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


CAUSES = [
    {
        "id": "wearing_issue",
        "label": "佩戴方式问题",
        "owner": "用户侧 / 佩戴方式",
        "owner_type": "user",
        "hint": "传感器贴肤、表带松紧、佩戴位置",
    },
    {
        "id": "power_issue",
        "label": "电量 / 开机问题",
        "owner": "用户侧",
        "owner_type": "user",
        "hint": "电量、充电触点、开机状态",
    },
    {
        "id": "sync_issue",
        "label": "蓝牙 / 同步链路",
        "owner": "用户侧 / 客服",
        "owner_type": "support",
        "hint": "蓝牙连接、App 同步、连接距离",
    },
    {
        "id": "app_issue",
        "label": "App 权限 / 账号",
        "owner": "用户侧 / 客服",
        "owner_type": "support",
        "hint": "权限、账号绑定、版本兼容",
    },
    {
        "id": "data_sufficiency",
        "label": "佩戴时长 / 数据延迟",
        "owner": "用户侧 / 产品预期",
        "owner_type": "support",
        "hint": "佩戴不足 4 小时、同步延迟、睡眠判定阈值",
    },
    {
        "id": "hardware_fault",
        "label": "硬件 / 固件故障",
        "owner": "研发 / 质量侧",
        "owner_type": "rd",
        "hint": "传感器、充电、固件异常、摔碰进水",
    },
    {
        "id": "needs_human",
        "label": "信息不足 / 需人工",
        "owner": "客服人工",
        "owner_type": "human",
        "hint": "回答矛盾、证据不足、需要人工复核",
    },
]
CAUSE_BY_ID = {cause["id"]: cause for cause in CAUSES}


STAGES = [
    {
        "id": "wear",
        "title": "佩戴检查",
        "assistant": "先看佩戴。昨晚手环背面的传感器是否贴着手腕内侧？表带是贴合，还是容易滑动、翻转？",
        "quick_replies": [
            {"label": "贴着手腕内侧，表带贴合", "value": "传感器贴着手腕内侧，表带贴合但不勒手。"},
            {"label": "有点松，会滑动", "value": "戴是戴了，但表带偏松，手环会滑动甚至翻转。"},
            {"label": "可能戴反 / 位置不对", "value": "可能戴在手背或手腕外侧，传感器没有贴住皮肤。"},
            {"label": "昨晚没戴", "value": "昨晚没有戴，或者中途摘下来了。"},
            {"label": "不确定", "value": "不太确定，记不清了。"},
        ],
        "question": {
            "type": "choice",
            "instructions": "根据 `current_question` 和 `user_answer`，判断用户的佩戴情况属于哪一类。只依据用户回答，不要假设未提供的信息。",
            "criteria": {
                "correct": "传感器贴着手腕内侧，表带贴合但不勒手，整晚正常佩戴",
                "loose": "佩戴了，但表带偏松，手环滑动或翻转，传感器可能间歇接触不良",
                "wrong_position": "戴在手背 / 手腕外侧，或传感器没有贴住皮肤",
                "not_worn": "昨晚没有佩戴，或中途摘下",
                "unclear": "回答含糊，无法判断佩戴方式",
            },
        },
        "effects": {
            "correct": {},
            "loose": {"wearing_issue": 3},
            "wrong_position": {"wearing_issue": 4},
            "not_worn": {"wearing_issue": 5, "data_sufficiency": 2},
            "unclear": {"needs_human": 1},
        },
    },
    {
        "id": "power",
        "title": "电量与开机",
        "assistant": "手环现在有电吗？昨晚是否正常开机？早上抬腕亮屏、震动或充电指示有没有反应？",
        "quick_replies": [
            {"label": "有电，开机正常", "value": "有电，开机正常，早上抬腕亮屏和震动都有反应。"},
            {"label": "电量低 / 没充电", "value": "电量比较低，昨晚没有充电，但还能开机。"},
            {"label": "开不了机 / 没反应", "value": "开不了机，屏幕和震动都没有反应。"},
            {"label": "充电触点脏 / 充不进电", "value": "充电触点有点脏，感觉充不进电，或充电时断时续。"},
            {"label": "不确定", "value": "不确定电量，也没注意有没有亮屏。"},
        ],
        "question": {
            "type": "choice",
            "instructions": "根据 `current_question` 和 `user_answer`，判断手环的电量与开机状态属于哪一类。只依据用户回答。",
            "criteria": {
                "normal": "有电、正常开机，屏幕 / 震动 / 充电指示有反应",
                "low_battery": "电量低或昨晚未充电，但仍能开机",
                "off": "关机、无法开机，或屏幕 / 震动完全没有反应",
                "charging_issue": "充电触点脏、充不进电，或充电连接不稳定",
                "unclear": "回答含糊，无法判断电量或开机状态",
            },
        },
        "effects": {
            "normal": {},
            "low_battery": {"power_issue": 4},
            "off": {"power_issue": 5},
            "charging_issue": {"power_issue": 4, "hardware_fault": 1},
            "unclear": {"needs_human": 1},
        },
    },
    {
        "id": "sync",
        "title": "蓝牙与同步",
        "assistant": "打开 App 时，手环和手机的蓝牙连接正常吗？App 里是显示「已连接 / 正在同步」，还是停留在旧数据、一直转圈？",
        "quick_replies": [
            {"label": "已连接并同步成功", "value": "手机蓝牙已连接，App 显示同步成功，但就是没有昨晚的睡眠数据。"},
            {"label": "已连接但不同步 / 卡住", "value": "显示已连接，但 App 一直不同步，或者同步到一半卡住。"},
            {"label": "蓝牙连不上 / 搜不到", "value": "手机搜不到手环，蓝牙一直连不上。"},
            {"label": "刚同步，可能还在处理", "value": "刚刚才同步，App 可能还在处理数据。"},
            {"label": "不确定", "value": "不确定有没有连接成功，也没注意同步状态。"},
        ],
        "question": {
            "type": "choice",
            "instructions": "根据 `current_question` 和 `user_answer`，判断蓝牙 / App 同步链路属于哪一类。只依据用户回答。",
            "criteria": {
                "connected_synced": "蓝牙已连接，App 已显示同步成功，但睡眠数据仍缺失",
                "connected_no_sync": "已连接但同步失败、卡住，或一直停留在旧数据",
                "not_connected": "蓝牙连不上、搜不到设备，或连接频繁断开",
                "sync_delay": "刚完成同步，数据可能仍在处理 / 延迟",
                "unclear": "回答含糊，无法判断蓝牙或同步状态",
            },
        },
        "effects": {
            "connected_synced": {},
            "connected_no_sync": {"sync_issue": 4},
            "not_connected": {"sync_issue": 5},
            "sync_delay": {"data_sufficiency": 2},
            "unclear": {"needs_human": 1},
        },
    },
    {
        "id": "app",
        "title": "App 权限与账号",
        "assistant": "App 是否拿到了蓝牙和健康数据权限？手环绑定的是你当前登录的账号吗？最近有没有更新 App 或换手机？",
        "quick_replies": [
            {"label": "权限、账号都正常", "value": "蓝牙和健康权限都开着，手环绑定在当前账号，最近没有换手机。"},
            {"label": "权限被关了 / 没授权", "value": "好像没有给 App 蓝牙或健康数据权限。"},
            {"label": "登录了别的账号", "value": "现在登录的是另一个账号，手环可能绑在旧账号上。"},
            {"label": "刚更新 App / 换手机", "value": "最近刚更新过 App，或者换了手机，之后就不太正常。"},
            {"label": "不确定", "value": "不太确定权限和账号绑定情况。"},
        ],
        "question": {
            "type": "choice",
            "instructions": "根据 `current_question` 和 `user_answer`，判断 App 权限 / 账号 / 版本状态属于哪一类。只依据用户回答。",
            "criteria": {
                "ok": "权限齐全，账号与设备绑定正常，版本没有明显异常",
                "permission_missing": "蓝牙或健康数据权限被关闭 / 未授权",
                "wrong_account": "登录了其他账号，或设备绑定在旧账号",
                "version_issue": "App 版本过旧，或更新 / 换手机后出现异常",
                "unclear": "回答含糊，无法判断权限、账号或版本",
            },
        },
        "effects": {
            "ok": {},
            "permission_missing": {"app_issue": 4},
            "wrong_account": {"app_issue": 5},
            "version_issue": {"app_issue": 3},
            "unclear": {"needs_human": 1},
        },
    },
    {
        "id": "duration",
        "title": "佩戴时长与数据预期",
        "assistant": "昨晚实际戴了多久？有没有中途摘下、手环明显松动，或者睡眠时间本身比较短（少于 4 小时）？",
        "quick_replies": [
            {"label": "整晚 6 小时以上，没松动", "value": "整晚戴了 6 小时以上，中间没有摘，也没有明显松动。"},
            {"label": "中途摘过 / 反复松动", "value": "中途摘过几次，或者手环反复松动。"},
            {"label": "不到 4 小时", "value": "昨晚只睡了 / 戴了不到 4 小时。"},
            {"label": "只是白天小睡 / 分段睡眠", "value": "主要是白天小睡，或者睡眠分成好几段。"},
            {"label": "不确定", "value": "不太确定具体戴了多久。"},
        ],
        "question": {
            "type": "choice",
            "instructions": "根据 `current_question` 和 `user_answer`，判断佩戴时长与睡眠数据充分性属于哪一类。只依据用户回答。",
            "criteria": {
                "sufficient": "整晚佩戴 6 小时以上，没有明显松动或中途摘下",
                "intermittent": "中途摘过，或手环反复松动，佩戴不连续",
                "short": "实际佩戴或睡眠时间不足 4 小时",
                "naps": "主要是白天小睡 / 分段睡眠，不是整晚连续睡眠",
                "unclear": "回答含糊，无法判断佩戴时长",
            },
        },
        "effects": {
            "sufficient": {},
            "intermittent": {"wearing_issue": 2, "data_sufficiency": 2},
            "short": {"data_sufficiency": 4},
            "naps": {"data_sufficiency": 3},
            "unclear": {"needs_human": 1},
        },
    },
    {
        "id": "hardware",
        "title": "硬件自检",
        "assistant": "最后做一次硬件自检：手环震动、抬腕亮屏、充电都正常吗？充电触点是否干净？最近有摔碰、进水或长时间闲置吗？",
        "quick_replies": [
            {"label": "都正常，没有摔碰进水", "value": "震动、亮屏、充电都正常，没有摔碰或进水。"},
            {"label": "有异常 / 摔碰 / 进水", "value": "震动、亮屏或充电有异常，最近摔过或进过水。"},
            {"label": "固件升级失败 / 版本异常", "value": "基本功能正常，但固件升级失败过，或者版本显示异常。"},
            {"label": "不确定 / 没注意", "value": "不确定，平时没注意这些。"},
        ],
        "question": {
            "type": "choice",
            "instructions": "根据 `current_question` 和 `user_answer`，判断硬件 / 固件自检结果属于哪一类。只依据用户回答。",
            "criteria": {
                "normal": "震动、亮屏、充电都正常，没有摔碰或进水",
                "abnormal": "震动 / 亮屏 / 充电异常，或近期有摔碰 / 进水",
                "firmware": "功能基本正常，但固件升级失败或版本异常",
                "unknown": "回答含糊，无法判断硬件状态",
            },
        },
        "effects": {
            "normal": {},
            "abnormal": {"hardware_fault": 5, "needs_human": 1},
            "firmware": {"hardware_fault": 3},
            "unknown": {"needs_human": 1},
        },
    },
]
STAGE_BY_ID = {stage["id"]: stage for stage in STAGES}


RECOMMENDATIONS = {
    "wearing_issue": {
        "owner": "用户侧 / 佩戴方式",
        "owner_type": "user",
        "actions": [
            "按说明书将传感器面贴紧手腕内侧，避开腕骨突出处。",
            "表带调到贴合但不勒手的程度，确保夜间不会滑动或翻转。",
            "重新佩戴一整晚，次日打开 App 手动同步后观察。",
            "若佩戴规范后仍连续 2 晚无数据，再按硬件故障流程送检。",
        ],
    },
    "power_issue": {
        "owner": "用户侧",
        "owner_type": "user",
        "actions": [
            "先充电 30 分钟以上，确认手环能正常开机。",
            "清洁充电触点，排除汗液、灰尘或氧化导致的接触不良。",
            "开机后重新连接 App 并手动同步。",
            "仍无法开机时，记录电量与充电表现，走售后检测。",
        ],
    },
    "sync_issue": {
        "owner": "用户侧 / 客服",
        "owner_type": "support",
        "actions": [
            "保持 App 在前台、蓝牙开启，手机靠近手环后手动同步。",
            "重启手机蓝牙和 App；必要时解除绑定后重新连接。",
            "确认手机系统没有限制 App 的后台蓝牙权限。",
            "连续两次同步失败时，收集 App 日志和同步时间点提交客服。",
        ],
    },
    "app_issue": {
        "owner": "用户侧 / 客服",
        "owner_type": "support",
        "actions": [
            "在系统设置中开启 App 的蓝牙和健康数据权限。",
            "确认当前登录账号就是绑定手环的账号。",
            "更新 App 到最新版本，或回到兼容版本后重试。",
            "重新登录 / 重新绑定设备；若数据仍缺失，提交账号与 App 版本信息。",
        ],
    },
    "data_sufficiency": {
        "owner": "用户侧 / 产品预期",
        "owner_type": "support",
        "actions": [
            "睡眠数据通常需要足够的连续佩戴时长；建议连续佩戴 2–3 晚再判断。",
            "确认睡眠时长不少于 4 小时，且夜间没有频繁摘下。",
            "查看 App 的同步时间；部分数据存在延迟，可在数小时后再次查看。",
            "若连续多晚满足条件仍无数据，按同步 / 硬件问题继续排查。",
        ],
    },
    "hardware_fault": {
        "owner": "研发 / 质量侧",
        "owner_type": "rd",
        "actions": [
            "记录设备型号、设备 ID、固件版本、App 版本和手机型号。",
            "导出 App 同步日志与手环原始传感器 / 睡眠记录。",
            "执行震动、亮屏、充电和传感器自检；必要时 RMA 送检。",
            "提缺陷单，附本次 6 轮问答、Jev 判断结果和复现步骤。",
        ],
    },
    "needs_human": {
        "owner": "客服人工",
        "owner_type": "human",
        "actions": [
            "转人工客服，补充购买凭证、设备 ID 和 App 账号信息。",
            "请用户提供佩戴照片、同步截图和手环自检结果。",
            "若涉及安全、过敏、进水或反复故障，优先升级处理。",
            "人工确认后再决定是指导佩戴、换货还是研发介入。",
        ],
    },
}


FINAL_CRITERIA = {
    "wearing_issue": "佩戴位置不对、表带松、传感器没有持续贴肤，或夜间没有佩戴，导致设备没有采集到有效睡眠数据",
    "power_issue": "电量不足、设备未开机、充电触点或充电链路异常，导致整晚没有正常记录",
    "sync_issue": "设备可能已记录，但蓝牙未连接、App 同步失败或卡住，数据没有上传到手机",
    "app_issue": "App 蓝牙 / 健康权限缺失、登录账号或设备绑定错误、App 版本兼容问题，导致看不到数据",
    "data_sufficiency": "佩戴或睡眠时长不足、白天小睡 / 分段睡眠、同步延迟或睡眠判定阈值导致暂无数据，不一定是故障",
    "hardware_fault": "传感器、充电、震动 / 亮屏等硬件异常，或固件升级失败 / 版本异常，需要研发或质量侧检测",
    "needs_human": "现有信息不足、回答矛盾，或存在安全 / 质量风险，无法可靠定位，需要人工复核",
}


FINAL_SEVERITY_FALLBACK = {
    "0": "可自助解决，无数据丢失风险",
    "1": "需要客服跟进或再次验证",
    "2": "需要研发 / 质量介入、退换货或存在安全风险",
}


def as_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def clean_history(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    cleaned = []
    for item in raw[-12:]:
        if not isinstance(item, dict):
            continue
        signal = item.get("signal") if isinstance(item.get("signal"), dict) else {}
        cleaned.append(
            {
                "stage_id": str(item.get("stage_id", ""))[:40],
                "stage_title": str(item.get("stage_title", ""))[:80],
                "question": str(item.get("question", ""))[:1000],
                "answer": str(item.get("answer", ""))[:2000],
                "signal": {
                    "choice": str(signal.get("choice", ""))[:40],
                    "label": str(signal.get("label", ""))[:300],
                    "confidence": clamp(as_float(signal.get("confidence", 0))),
                    "clear": clamp(as_float(signal.get("clear", 0))),
                },
            }
        )
    return cleaned


def rule_scores(history: list[dict]) -> dict[str, int]:
    scores = {cause["id"]: 0 for cause in CAUSES}
    for item in history:
        stage = STAGE_BY_ID.get(item.get("stage_id"))
        if not stage:
            continue
        choice = item.get("signal", {}).get("choice")
        for cause, delta in stage.get("effects", {}).get(choice, {}).items():
            scores[cause] = scores.get(cause, 0) + delta
    return scores


def public_payload() -> dict:
    return {
        "product": "睡眠手环",
        "complaint": "用户购买睡眠手环，佩戴一整晚后，第二天 App 中没有睡眠数据。",
        "stages": [
            {
                "id": stage["id"],
                "title": stage["title"],
                "assistant": stage["assistant"],
                "quick_replies": stage["quick_replies"],
            }
            for stage in STAGES
        ],
        "causes": CAUSES,
        "model": MODEL,
    }


class JevError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"Jev API HTTP {status}: {detail}")
        self.status = status
        self.detail = detail


def call_jev(payload: dict) -> tuple[dict, int, dict]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "sleep-bracelet-triage-demo/1.0",
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
    return data, latency_ms, payload


def answer_map(raw: dict) -> dict:
    answers = raw.get("answers")
    return answers if isinstance(answers, dict) else {}


def handle_turn(body: dict) -> dict:
    stage_id = str(body.get("stage_id", ""))
    stage = STAGE_BY_ID.get(stage_id)
    if not stage:
        raise ValueError("unknown stage_id")

    answer = str(body.get("answer", "")).strip()[:2000]
    if not answer:
        raise ValueError("answer is required")

    history = clean_history(body.get("history"))
    state = {
        "product": "睡眠手环",
        "complaint": "用户购买睡眠手环，佩戴一整晚后，第二天 App 中没有睡眠数据。",
        "stage": stage["title"],
        "current_question": stage["assistant"],
        "user_answer": answer,
        "qa_history": history,
    }
    questions = {
        "answer_class": stage["question"],
        "answer_clear": {
            "type": "noul",
            "instructions": "结合 `current_question` 与 `user_answer`，用户是否明确、具体地回答了当前问题？",
        },
    }
    payload = {"model": MODEL, "state": state, "questions": questions}
    raw, latency_ms, payload = call_jev(payload)
    answers = answer_map(raw)

    answer_class = answers.get("answer_class") or {}
    choice = str(answer_class.get("choice", "unclear"))
    criteria = stage["question"]["criteria"]
    if choice not in criteria:
        choice = "unclear"

    clear_raw = answers.get("answer_clear") or {}
    signal = {
        "choice": choice,
        "label": criteria[choice],
        "confidence": round(clamp(as_float(answer_class.get("confidence", 0))), 3),
        "probabilities": answer_class.get("probabilities", {}),
        "clear": round(clamp(as_float(clear_raw.get("noul", 0.5))), 3),
    }

    index = STAGES.index(stage)
    next_stage_id = STAGES[index + 1]["id"] if index + 1 < len(STAGES) else None

    return {
        "stage_id": stage["id"],
        "stage_title": stage["title"],
        "signal": signal,
        "effects": stage["effects"].get(choice, {}),
        "next_stage_id": next_stage_id,
        "usage": raw.get("usage", {}),
        "latency_ms": latency_ms,
        "request": payload,
        "response": raw,
    }


def handle_final(body: dict) -> dict:
    history = clean_history(body.get("history"))
    if not history:
        raise ValueError("history is required")

    scores = rule_scores(history)
    state = {
        "product": "睡眠手环",
        "complaint": "用户购买睡眠手环，佩戴一整晚后，第二天 App 中没有睡眠数据。",
        "qa_history": history,
        "rule_scores": scores,
        "signal_summary": [
            {
                "stage": item["stage_title"],
                "choice": item["signal"]["choice"],
                "label": item["signal"]["label"],
                "confidence": item["signal"]["confidence"],
                "clear": item["signal"]["clear"],
            }
            for item in history
        ],
    }
    questions = {
        "final_cause": {
            "type": "choice",
            "instructions": "综合 `qa_history`、`signal_summary` 和 `rule_scores`，判断导致「首夜没有睡眠数据」的最可能根因。只依据已有证据，不要假设未提供的信息。",
            "criteria": FINAL_CRITERIA,
        },
        "needs_human": {
            "type": "noul",
            "instructions": "现有信息是否不足以定位，或存在安全 / 质量风险，需要人工介入？",
        },
        "severity": {
            "type": "score",
            "instructions": "该问题对用户的影响程度和升级优先级如何？",
            "criteria": [
                "可自助解决，无数据丢失风险",
                "需要客服跟进或再次验证",
                "需要研发 / 质量介入、退换货或存在安全风险",
            ],
        },
    }
    payload = {"model": MODEL, "state": state, "questions": questions}
    raw, latency_ms, payload = call_jev(payload)
    answers = answer_map(raw)

    final_obj = answers.get("final_cause") or {}
    original_choice = str(final_obj.get("choice", "needs_human"))
    if original_choice not in CAUSE_BY_ID:
        original_choice = "needs_human"
    confidence = round(clamp(as_float(final_obj.get("confidence", 0))), 3)

    needs_human = round(
        clamp(as_float((answers.get("needs_human") or {}).get("noul", 0))), 3
    )
    severity_obj = answers.get("severity") or {}
    severity_score = round(clamp(as_float(severity_obj.get("score", 0)), 0, 2), 2)
    severity_legend = severity_obj.get("legend") or {}
    severity_level = str(int(round(severity_score)))
    severity_label = (
        severity_legend.get(severity_level)
        or FINAL_SEVERITY_FALLBACK.get(severity_level)
        or FINAL_SEVERITY_FALLBACK["0"]
    )

    unclear_count = sum(
        1
        for item in history
        if item["signal"]["choice"] == "unclear"
        or item["signal"]["clear"] < 0.45
    )
    top_rule_score = max(scores.values()) if scores else 0
    override_reason = None
    choice = original_choice
    if choice != "needs_human":
        # A high "needs human" probability does not erase a strong, actionable
        # signal. Only override to human review when the main cause is weak
        # and the rule engine has no decisive evidence either.
        if (confidence < 0.4 and top_rule_score < 3) or unclear_count >= 4:
            override_reason = (
                "Jev 对主因的置信度较低，且规则侧没有形成明确强信号，"
                "规则守卫已将结论转为人工复核。"
            )
            choice = "needs_human"
        elif needs_human >= 0.8 and top_rule_score < 3:
            override_reason = (
                "Jev 建议人工介入，且规则侧没有形成明确强信号，"
                "规则守卫已将结论转为人工复核。"
            )
            choice = "needs_human"

    cause = CAUSE_BY_ID[choice]
    recommendation = RECOMMENDATIONS[choice]
    review_note = None
    if choice != "needs_human" and needs_human >= 0.7:
        review_note = (
            f"Jev 仍建议人工复核（人工介入概率 {needs_human:.0%}）。"
            f"主因继续按「{cause['label']}」路由，可先执行建议动作，"
            "同时补充设备日志或自检细节。"
        )
    evidence = [
        {
            "stage": item["stage_title"],
            "choice": item["signal"]["choice"],
            "label": item["signal"]["label"],
            "confidence": item["signal"]["confidence"],
            "clear": item["signal"]["clear"],
        }
        for item in history
    ]

    return {
        "final_cause": {
            "choice": choice,
            "original_choice": original_choice,
            "label": cause["label"],
            "confidence": confidence,
            "probabilities": final_obj.get("probabilities", {}),
        },
        "needs_human": needs_human,
        "severity": {
            "score": severity_score,
            "confidence": round(
                clamp(as_float(severity_obj.get("confidence", 0))), 3
            ),
            "label": severity_label,
        },
        "rule_scores": scores,
        "recommendation": recommendation,
        "owner_type": cause["owner_type"],
        "evidence": evidence,
        "override_reason": override_reason,
        "review_note": review_note,
        "usage": raw.get("usage", {}),
        "latency_ms": latency_ms,
        "request": payload,
        "response": raw,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "SleepTriageDemo/1.0"

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_index(self) -> None:
        index_path = BASE_DIR / "index.html"
        if not index_path.exists():
            self.send_json(500, {"error": "index.html not found"})
            return
        body = index_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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
        if self.path in ("/", "/index.html"):
            self.send_index()
        elif self.path == "/api/stages":
            self.send_json(200, public_payload())
        elif self.path == "/api/health":
            self.send_json(
                200,
                {
                    "ok": True,
                    "model": MODEL,
                    "key_configured": bool(API_KEY),
                    "env_file_loaded": ENV_FILE_LOADED,
                    "proxy_configured": bool(PROXY),
                    "host": HOST,
                    "port": PORT,
                },
            )
        elif self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/api/turn", "/api/final"):
            self.send_json(404, {"error": "not found"})
            return
        try:
            body = self.read_json()
            if self.path == "/api/turn":
                self.send_json(200, handle_turn(body))
            else:
                self.send_json(200, handle_final(body))
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except JevError as exc:
            detail = exc.detail[:1200]
            self.send_json(
                502,
                {
                    "error": "Jev API request failed",
                    "status": exc.status,
                    "detail": detail,
                },
            )
        except Exception as exc:  # keep the demo responsive on unexpected errors
            print(f"[error] {type(exc).__name__}: {exc}", file=sys.stderr)
            self.send_json(500, {"error": "internal server error"})

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def validate_config() -> None:
    for stage in STAGES:
        criteria = stage["question"]["criteria"]
        unknown = set(stage["effects"]) - set(criteria)
        if unknown:
            raise SystemExit(
                f"stage {stage['id']} has effects for unknown choices: {unknown}"
            )
    for stage in STAGES:
        for effects in stage["effects"].values():
            for cause in effects:
                if cause not in CAUSE_BY_ID:
                    raise SystemExit(
                        f"stage {stage['id']} references unknown cause: {cause}"
                    )


def main() -> None:
    if sys.version_info < (3, 8):
        print("需要 Python 3.8 或更高版本。", file=sys.stderr)
        raise SystemExit(1)

    validate_config()
    if not API_KEY:
        print(
            "TYPESAFE_API_KEY 未设置。任选一种方式：\n"
            "  1) cp support-demo/env.example support-demo/.env 并填写 key\n"
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
                f"  PORT={PORT + 1} bash support-demo/start.sh",
                file=sys.stderr,
            )
            raise SystemExit(1) from exc
        raise

    print(f"Sleep bracelet triage demo: http://{HOST}:{PORT}")
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
