#!/usr/bin/env bash
# Jev System One API — 一键复跑内部分享文档 §5 的 9 个示例。
#
# 前置：key 默认从仓库根目录的 .env 读取（无需 export）。
#   PROXY=http://127.0.0.1:7890   # 可选；留空则自动探测本机 7890
#
# 运行：
#   bash jev-demo-all.sh
#
# 说明：
#   - 示例 3 的「潜台词」选项在原始截图中被截断，这里按语境补写，
#     复跑概率可能与文档中的 90% / 8% 略有差异。
#   - 模型输出有随机性；文档中的分数/置信度是首次运行结果，复跑会波动。
#   - 所有请求都是真实调用，会产生 token 费用。

set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/load-env.sh"

PROXY="${PROXY-}"
BASE_URL="${JEV_BASE_URL:-https://api.jevgo.cn}"
URL="${JEV_API_URL:-$BASE_URL/v1/systemone}"

if [ -z "${TYPESAFE_API_KEY:-}" ]; then
  echo "TYPESAFE_API_KEY 未设置。在仓库根目录创建 .env 并填入：" >&2
  echo "  TYPESAFE_API_KEY=sk-jh-..." >&2
  echo "或临时： export TYPESAFE_API_KEY=\"...\"" >&2
  exit 1
fi

post() {
  local name="$1"
  local req resp code
  req=$(mktemp)
  resp=$(mktemp)
  cat > "$req"

  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  $name"
  echo "════════════════════════════════════════════════════════════"
  echo "----- 请求参数（model / state / questions）-----"
  python3 -m json.tool --no-ensure-ascii "$req" 2>/dev/null || cat "$req"
  echo "----- 响应 -----"

  local args=(--silent --show-error
              --connect-timeout 10 --max-time 60
              -H "Authorization: Bearer $TYPESAFE_API_KEY"
              -H "Content-Type: application/json"
              --data-binary "@$req"
              -o "$resp" -w '%{http_code}'
              "$URL")
  if [ -n "$PROXY" ]; then
    args=(--proxy "$PROXY" "${args[@]}")
  fi

  code=$(curl "${args[@]}")
  echo "HTTP $code"
  python3 -m json.tool --no-ensure-ascii "$resp" 2>/dev/null || cat "$resp"
  rm -f "$req" "$resp"
}

echo "════════════════════════════════════════════════════════════"
echo "  GET /v1/models — 当前账号可用模型"
echo "════════════════════════════════════════════════════════════"
models_args=(--silent --show-error --connect-timeout 10 --max-time 60
             -H "Authorization: Bearer $TYPESAFE_API_KEY"
             "$BASE_URL/v1/models")
if [ -n "$PROXY" ]; then
  models_args=(--proxy "$PROXY" "${models_args[@]}")
fi
curl "${models_args[@]}" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || echo "模型列表请求失败"

post "示例 1 · 重复扣费投诉（noul，参考值 0.96）" <<'JSON'
{
  "model": "jev-latest",
  "state": "客户说：我被重复扣费了，请立刻解决！",
  "questions": {
    "urgency": {
      "type": "noul",
      "instructions": "这条消息是否表达了紧急情绪？"
    }
  }
}
JSON

post "示例 2 · 工单分流（choice + score + choice + noul）" <<'JSON'
{
  "model": "jev-latest",
  "state": {
    "message": "接口持续返回 500，线上订单全部失败，已经等了半小时，太耽误事了，请立即处理！"
  },
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "应该由哪个部门优先处理 `message` 中的问题？",
      "criteria": {
        "technical": "程序故障、接口报错、系统不可用",
        "billing": "扣款、账单、发票问题",
        "sales": "售前咨询、报价和购买方案",
        "other": "不属于以上类别，或现有信息无法确定"
      }
    },
    "urgency": {
      "type": "score",
      "instructions": "`message` 描述的问题有多紧急？",
      "criteria": [
        "无时间要求，可以等待常规处理",
        "希望尽快处理，但未报告业务中断",
        "业务已中断，或明确要求立即处理"
      ]
    },
    "tone": {
      "type": "choice",
      "instructions": "`message` 中客户表现出的主要情绪是什么？",
      "criteria": {
        "calm": "平静陈述事实，没有明显不满",
        "frustrated": "明确不满或抱怨，但没有激烈攻击",
        "angry": "激烈愤怒、辱骂或攻击性表达"
      }
    },
    "business_blocked": {
      "type": "noul",
      "instructions": "`message` 是否报告核心业务已经无法继续进行？"
    }
  }
}
JSON

post "示例 3 · 女朋友聊天（noul + score + choice；潜台词选项为补写）" <<'JSON'
{
  "model": "jev-latest",
  "state": {
    "背景": "女朋友想聊天，男朋友却一直在玩游戏。",
    "聊天记录": [
      "女朋友：今天工作好烦啊。",
      "男朋友：嗯。",
      "女朋友：算了，你忙吧，我不打扰你了。"
    ]
  },
  "questions": {
    "是否不满": {
      "type": "noul",
      "instructions": "女朋友是否在表达不满？",
      "criteria": {
        "true": "对男朋友敷衍的回复感到不满",
        "false": "没有明显表达不满"
      }
    },
    "不满程度": {
      "type": "score",
      "instructions": "评估女朋友表达不满的程度。",
      "criteria": [
        "没有明显不满",
        "有些不满，但情绪比较平和",
        "明显不满，对男朋友的态度感到失望",
        "非常不满，明确表达愤怒"
      ]
    },
    "潜台词": {
      "type": "choice",
      "instructions": "女朋友说「算了，你忙吧，我不打扰你了」，最可能的潜台词是什么？",
      "criteria": {
        "A": "希望男朋友放下游戏，认真陪自己聊天",
        "B": "准备冷战，暂时不想理男朋友",
        "C": "只是在陈述工作烦恼，没有别的意思",
        "D": "想结束对话，去忙自己的事"
      }
    }
  }
}
JSON

post "示例 4 · AI 助手选择工具（2 × choice）" <<'JSON'
{
  "model": "jev-latest",
  "state": {
    "message": "帮我看看明天下午有没有空。",
    "current_date": "2026-11-01",
    "timezone": "Asia/Shanghai",
    "available_tools": {
      "check_calendar": "查询当前登录用户的日历空闲时间",
      "search_docs": "搜索已有知识库文档"
    }
  },
  "questions": {
    "tool": {
      "type": "choice",
      "instructions": "`message` 最适合由 `available_tools` 中哪个工具处理？",
      "criteria": {
        "check_calendar": "需要查询用户日历、已有安排或空闲时间",
        "search_docs": "需要搜索知识库中的资料或说明",
        "unsupported": "现有工具都不适用，或无法确定所需操作"
      }
    },
    "calendar_window": {
      "type": "choice",
      "instructions": "如果 `message` 请求查询日历，其表达的查询时间属于哪一项？相对日期以 `current_date` 和 `timezone` 为准。",
      "criteria": {
        "today_afternoon": "当前日期的下午，13:00 至 18:00",
        "tomorrow_afternoon": "当前日期后一个自然日的下午，13:00 至 18:00",
        "other_or_unspecified": "其他时间、时间缺失，或不是日历查询"
      }
    }
  }
}
JSON

post "示例 5 · 搜索结果排序（3 × score，同一标准）" <<'JSON'
{
  "model": "jev-latest",
  "state": {
    "query": "如何在 Windows PowerShell 中给 Jev 发送 JSON 请求？",
    "candidates": [
      {
        "id": "d1",
        "text": "在 PowerShell 中使用 curl.exe，通过 --data-binary 提交 UTF-8 无 BOM 的 JSON 文件，并设置 Authorization 和 Content-Type。"
      },
      {
        "id": "d2",
        "text": "本文介绍如何创建 TypeSafe 账号和 API Key。"
      },
      {
        "id": "d3",
        "text": "本文介绍咖啡机的安装与日常保养。"
      }
    ]
  },
  "questions": {
    "relevance_d1": {
      "type": "score",
      "instructions": "`candidates[0].text` 在多大程度上直接回答 `query`？",
      "criteria": [
        "内容无关",
        "主题相关，但未提供问题所需信息",
        "提供部分所需信息，仍有关键缺失",
        "直接提供回答问题所需的核心信息"
      ]
    },
    "relevance_d2": {
      "type": "score",
      "instructions": "`candidates[1].text` 在多大程度上直接回答 `query`？",
      "criteria": [
        "内容无关",
        "主题相关，但未提供问题所需信息",
        "提供部分所需信息，仍有关键缺失",
        "直接提供回答问题所需的核心信息"
      ]
    },
    "relevance_d3": {
      "type": "score",
      "instructions": "`candidates[2].text` 在多大程度上直接回答 `query`？",
      "criteria": [
        "内容无关",
        "主题相关，但未提供问题所需信息",
        "提供部分所需信息，仍有关键缺失",
        "直接提供回答问题所需的核心信息"
      ]
    }
  }
}
JSON

post "示例 6 · 内容审核（2 × noul + score）" <<'JSON'
{
  "model": "jev-latest",
  "state": {
    "comment": "你这个蠢货，赶紧加我买课，今天付款半价！",
    "policy": {
      "spam": "未经请求推销商品、课程或服务，包含引导联系或付款的内容",
      "insult": "直接针对个人的贬低、辱骂或人身攻击；单纯批评产品不算"
    }
  },
  "questions": {
    "is_spam": {
      "type": "noul",
      "instructions": "依据 `policy.spam`，`comment` 是否包含广告推销？"
    },
    "is_insult": {
      "type": "noul",
      "instructions": "依据 `policy.insult`，`comment` 是否包含针对个人的辱骂？"
    },
    "severity": {
      "type": "score",
      "instructions": "依据 `policy`，`comment` 的违规程度如何？",
      "criteria": [
        "没有违反所给规则",
        "存在隐晦的推销或轻微的人身贬低，违规程度较轻",
        "存在直接引导购买或付款的广告，或明确的针对个人的辱骂"
      ]
    }
  }
}
JSON

post "示例 7 · 信息提取（choice + noul）" <<'JSON'
{
  "model": "jev-latest",
  "state": {
    "document": "商品原价 ¥1,200.00，优惠 ¥200.00，本次应付 ¥1,000.00。请按应付金额付款。",
    "candidates": {
      "c1": "¥1,200.00",
      "c2": "¥200.00",
      "c3": "¥1,000.00"
    }
  },
  "questions": {
    "payable_candidate": {
      "type": "choice",
      "instructions": "`candidates` 中哪个候选是 `document` 明确要求本次支付的应付金额？",
      "criteria": {
        "c1": "选择 `candidates.c1` 的原文金额",
        "c2": "选择 `candidates.c2` 的原文金额",
        "c3": "选择 `candidates.c3` 的原文金额",
        "none": "没有候选对应原文明确给出的应付金额"
      }
    },
    "has_payable_amount": {
      "type": "noul",
      "instructions": "`document` 是否明确给出了本次应付金额，而非仅给出原价或优惠额？"
    }
  }
}
JSON

post "示例 8 · 商品去重（score + 2 × noul）" <<'JSON'
{
  "model": "jev-latest",
  "state": {
    "entity_type": "product",
    "entity_a": {
      "name": "Acme Air 无线耳机 白色",
      "brand": "Acme",
      "model": "AIR-2",
      "spec": "白色，单副装"
    },
    "entity_b": {
      "name": "ACME Air 第二代耳机 / White",
      "brand": "ACME",
      "model": "AIR-2",
      "spec": "白色，1 副"
    }
  },
  "questions": {
    "match_strength": {
      "type": "score",
      "instructions": "综合名称、品牌、型号和规格，`entity_a` 与 `entity_b` 在多大程度上描述同一商品及规格？",
      "criteria": [
        "有明确证据表明是不同商品或不同规格",
        "商品相关，但关键信息缺失或含糊，无法确认相同",
        "关键信息一致，名称差异可解释为别名、语言或写法差异"
      ]
    },
    "names_equivalent": {
      "type": "noul",
      "instructions": "结合品牌、型号与规格，`entity_a.name` 与 `entity_b.name` 是否是同一商品名称的不同表述？"
    },
    "spec_conflict": {
      "type": "noul",
      "instructions": "`entity_a.spec` 与 `entity_b.spec` 是否在颜色、容量或包装数量上存在明确冲突？"
    }
  }
}
JSON

post "示例 9 · 英文 Stripe 工单（noul，参考值 0.98）" <<'JSON'
{
  "model": "jev-latest",
  "state": "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
  "questions": {
    "urgency": {
      "type": "noul",
      "instructions": "Does this message express urgency?"
    }
  }
}
JSON

echo ""
echo "完成：模型列表 + 9 个示例。"
