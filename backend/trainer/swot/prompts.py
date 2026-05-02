"""SWOT prompt templates (Stage-1 Map + Stage-2 Reduce).

The prompts are deliberately structural and JSON-only. We never let the model
free-text outside the JSON envelope; the parser bails fast on shape mismatch.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List


# ── Stage-1: Map ─────────────────────────────────────────────────────────────


_STAGE1_INSTRUCTIONS = """You are a sales-call analyst at Duroflex (a mattress retailer). I will give you {n_calls} analyzed inbound sales calls from a single retail store. Each call is a JSON object with fields like Agent NPS, Brand NPS, Call Summary, Agent Good/Bad, Brand Good/Bad, Customer Needs, Purchase Barrier Detail, Agent Learnings, Store Visit Barrier Detail, etc.

CONTEXT — every call here is already a CAPTURED inbound lead: the customer's phone number is on record (the "Clean Number" field). Lead-capture itself is therefore NOT a gap and must not be cited as a weakness.

Your job: extract the clearest *recurring* patterns in this batch and group them into four categories.

  - strengths: things this store / its agents do consistently well.
  - weaknesses: things this store / its agents do poorly or inconsistently.
  - opportunities: openings the store could lean into (often customer signals or unconverted demand).
  - threats: external pressures (competitors, brand vulnerabilities, channel issues) that risk losing business.

Hard rules:
  - Cite up to 3 evidence quotes per item, each tagged with the call's "Clean Number".
  - Only use Clean Numbers that appear in the input batch — never fabricate.
  - Keep each `theme` short (≤ 12 words) and each `detail` decision-grade (1–2 sentences).
  - If a category has no clear signal in this batch, return an empty list for it. Do NOT pad with weak themes.
  - Do NOT cite "agent failed to capture the lead / customer phone / contact details" as a weakness — every call in this dataset is already a captured inbound lead. (Missing follow-up *preferences* like preferred call-back time or WhatsApp opt-in IS still a valid weakness if absent.)

Return ONLY valid JSON. No markdown fences, no commentary outside the JSON.

Required JSON shape:
{{
  "strengths":     [{{ "theme": "...", "detail": "...", "evidence": [{{ "clean_number": "...", "quote": "..." }}] }}],
  "weaknesses":    [...same shape...],
  "opportunities": [...same shape...],
  "threats":       [...same shape...]
}}
"""


def stage1_map_prompt(batch: List[Dict[str, Any]]) -> str:
    """Build a Stage-1 prompt for one batch of calls."""
    return (
        _STAGE1_INSTRUCTIONS.format(n_calls=len(batch))
        + "\n\nInput batch:\n"
        + json.dumps(batch, ensure_ascii=False, indent=2)
    )


# ── Stage-2: Reduce ──────────────────────────────────────────────────────────


_STAGE2_SWOT_INSTRUCTIONS = """You are a sales-leadership analyst at Duroflex synthesising a Store SWOT for store "{store_name}". Your audience is the Chief Sales Officer, Head of Store Sales, and Chief Growth Officer — decision-grade insights only.

You have {n_partials} partial SWOT extractions from {n_total_calls} recent calls at this store. MERGE and PRIORITISE them into ONE clean SWOT.

Priorities for the synthesis:
  1. Collapse near-duplicate themes into a single, sharper theme.
  2. Rank by FREQUENCY and SEVERITY (revenue, brand trust, repeat behaviour).
  3. For each merged item:
       - "evidence_count" = total quotes you saw across partials for this theme.
       - "representative_quotes" = up to 3 STRONGEST verbatim quotes from the input (do not invent).
       - "example_clean_numbers" = up to 5 phone numbers (Clean Numbers) from the partials' evidence that most strongly exhibit this theme. Copy them VERBATIM. NO PADDING — if fewer than 5 exist, list whatever's available.
       - "severity" = "low" / "medium" / "high".
  4. Caps: at most 7 strengths, 7 weaknesses, 5 opportunities, 5 threats. Trim ruthlessly.

Hard rules:
  - Output ONLY valid JSON, no fences, no surrounding prose.
  - "theme" max 12 words. "detail" max 2 sentences.
  - "representative_quotes" must be verbatim strings from the input partials' evidence.
  - "example_clean_numbers" entries must appear in the input partials' evidence Clean Numbers. NEVER invent.
  - Drop any partial-extracted weakness whose theme is "agent failed to capture the lead / phone / contact" — every call in this dataset is already a captured inbound lead. (Missing follow-up preferences like WhatsApp opt-in or preferred call-back time IS still valid.)

Required JSON shape:
{{
  "strengths":     [{{ "theme": "...", "detail": "...", "severity": "low|medium|high",
                       "evidence_count": 0, "representative_quotes": ["...", "..."],
                       "example_clean_numbers": ["..."] }}],
  "weaknesses":    [...same shape...],
  "opportunities": [...same shape...],
  "threats":       [...same shape...],
  "notes":         "optional one-line caveat string or null"
}}
"""


_STAGE2_FUNCTIONS_INSTRUCTIONS = """You are an executive ops analyst at Duroflex producing a function-by-function improvement plan for store "{store_name}". Audience: CSO + Head of Store Sales + CGO. Decision-grade, action-oriented.

You have {n_partials} partial SWOT extractions from {n_total_calls} recent calls at this store. Map every issue worth fixing to the team that OWNS the fix. Output 5 function blocks — even when a function has no signal, emit it with `items: []` so the UI knows it was scanned.

The 5 functions and their scope:

  1. sales_team — agent skill issues: weak probing, missed hooks, poor objection handling, brand-introduction lapses, rushed closes, missing follow-up preferences (preferred call-back time / WhatsApp opt-in / decision timeline). DO NOT cite "failed to capture the lead / customer phone" — every call in this dataset is already a captured inbound lead.
  2. marketing — lead-quality and brand-perception: false ad expectations, awareness gaps, attribution issues, lead targeting, campaign-vs-reality tone.
  3. supply_chain_and_delivery — stock-outs, late deliveries, damaged-on-arrival, no-show installs, return logistics.
  4. product_team — portfolio gaps: missing sizes/firmness/price-tier, defects, model-name confusion, feature mismatches, warranty design.
  5. omnichannel_team — web/app/store info inconsistency, online-to-store handoff, WhatsApp follow-up failures, online-vs-store price/offer parity.

For each function, identify up to 5 distinct improvement themes (typically 2-3). Each item:
  - "function": exactly one of: sales_team, marketing, supply_chain_and_delivery, product_team, omnichannel_team.
  - "theme": ≤12 words.
  - "detail": 1-2 sentence problem statement.
  - "recommended_action": ≤20 words. CONCRETE next step the function owner can do this week (e.g. "Coach agents on the 3-probe needs-discovery rule before pitching", "Push warehouse for queen-orthopedic restock with daily depletion report").
  - "severity": low / medium / high.
  - "evidence_count": total calls citing this issue across partials.
  - "example_clean_numbers": up to 5 verbatim Clean Numbers from the partials' evidence (NO padding, NO invention).

Attribution guide:
  - "Agent did not probe" / "agent rushed close" → sales_team
  - "Customer expected a discount the ad promised" → marketing
  - "Mattress was out of stock" / "delivery was late" → supply_chain_and_delivery
  - "Customer wanted a size we don't make" / "product defective" → product_team
  - "Website price differed from store" / "WhatsApp follow-up never happened" → omnichannel_team

A theme MAY map to multiple functions if it spans them (e.g. stock-out + poor agent recovery → both supply_chain_and_delivery AND sales_team) — duplicate the item under each relevant function with appropriately scoped recommended_action.

Hard rules:
  - Output ONLY valid JSON, no fences, no surrounding prose.
  - Always emit ALL 5 function blocks. When a function has no real signal, output `"items": []` — DO NOT invent issues to fill the slot.
  - "example_clean_numbers" entries must appear in the input partials' evidence Clean Numbers. NEVER invent.
  - Do NOT cite "agent failed to capture the lead / phone / contact" as an issue — every call here is already a captured inbound lead.

Required JSON shape:
{{
  "function_improvements": [
    {{ "function": "sales_team", "items": [
        {{ "function": "sales_team", "theme": "...", "detail": "...",
           "recommended_action": "...", "severity": "low|medium|high",
           "evidence_count": 0, "example_clean_numbers": ["..."] }}
    ]}},
    {{ "function": "marketing", "items": [...] }},
    {{ "function": "supply_chain_and_delivery", "items": [...] }},
    {{ "function": "product_team", "items": [...] }},
    {{ "function": "omnichannel_team", "items": [...] }}
  ]
}}
"""


# ── DEPRECATED single-mega-prompt (kept for reference; do not use) ──────────
_STAGE2_INSTRUCTIONS_LEGACY = """You are a sales-leadership analyst at Duroflex synthesising a Store SWOT for store "{store_name}". Your audience is the Chief Sales Officer, Head of Store Sales, and Chief Growth Officer — they need decision-grade insights, not paragraphs.

You have {n_partials} partial SWOT extractions, each derived from a different batch of recent calls at this store ({n_total_calls} calls in total). Your job is to MERGE and PRIORITISE these partials into ONE clean executive SWOT report.

The output has THREE blocks:
  A) The classic SWOT (strengths / weaknesses / opportunities / threats)
  B) Function Improvement Areas — segmented by the 5 functions that actually own the fixes
  C) Quick Stats — a 5-second headline strip

────────────────────────────────────────────────────────────────────────────
A) SWOT priorities:
  1. Collapse near-duplicate themes across partials into a single, sharper theme.
  2. Rank by FREQUENCY across partials and by SEVERITY of the underlying business impact (revenue, brand trust, repeat behaviour).
  3. For each merged item:
       - "evidence_count" = total quotes you saw across all partials for this theme.
       - "representative_quotes" = up to 3 of the strongest verbatim quotes (do not invent — only re-use quotes from the partials).
       - "example_clean_numbers" = up to 5 phone numbers (Clean Number values) from the partials' evidence that most strongly exhibit this theme. Copy them VERBATIM from the input — never invent or guess. If fewer than 5 exist, list whatever is available. NO PADDING.
       - "severity" = "low" / "medium" / "high" — calibrate like a sales head briefing the CEO.
  4. Caps: at most 7 strengths, 7 weaknesses, 5 opportunities, 5 threats. Trim ruthlessly.

────────────────────────────────────────────────────────────────────────────
B) Function Improvement Areas — for each of the 5 functions below, identify up to 5 distinct themes (typically 2-3) that the function owner should act on:

  1. sales_team — agent skill issues: weak probing, missed hooks, poor objection handling, brand-introduction lapses, rushed closes, not capturing follow-up details.
  2. marketing — lead-quality and brand-perception issues: false ad expectations, brand awareness gaps, channel-attribution issues, poor lead targeting, tone of campaigns vs in-store reality.
  3. supply_chain_and_delivery — stock-outs / out-of-stock disappointments, late deliveries, damaged-on-arrival, no-show installations, return logistics.
  4. product_team — product-portfolio gaps: missing sizes/firmness/price-tier, defects mentioned, model-name confusion, feature mismatches with customer expectations, warranty design.
  5. omnichannel_team — web/app/store info inconsistency, online order handoff to store, WhatsApp follow-up failures, price/offer parity online-vs-store.

For EACH function block, output an object even if items is empty:
  - When real signal exists in the partials (theme touches the function's scope), produce 1-5 items.
  - When NO theme in the partials maps to this function, output `"items": []` — do NOT invent issues to fill the slot. The UI shows "No issues identified for this period" so executives know the function was scanned.

Each item:
  - "function": exactly one of the 5 keys above.
  - "theme": ≤12 words.
  - "detail": 1-2 sentence problem statement.
  - "recommended_action": ≤20 words. CONCRETE next step the function owner can do this week (e.g. "Coach agents on the 3-probe needs-discovery rule before pitching", "Push warehouse to refresh queen-orthopedic stock; daily depletion report").
  - "severity": low / medium / high.
  - "evidence_count": total calls citing this issue across partials.
  - "example_clean_numbers": up to 5 verbatim Clean Numbers from the partials' evidence (NO padding, NO invention).

How to attribute a SWOT theme to a function:
  - "Agent did not probe" / "agent rushed close" → sales_team
  - "Customer expected a discount that ad promised" → marketing
  - "Mattress was out of stock" / "delivery was late" → supply_chain_and_delivery
  - "Customer wanted a size we don't make" / "product defective" → product_team
  - "Website price differed from store" / "WhatsApp follow-up never happened" → omnichannel_team

A single SWOT theme MAY map to multiple functions if it spans them (e.g. a stock-out AND poor agent recovery → both supply_chain_and_delivery AND sales_team) — duplicate the item under each relevant function with appropriately scoped recommended_action.

────────────────────────────────────────────────────────────────────────────
C) Quick Stats:
  - "calls_analyzed": exact integer = {n_total_calls}.
  - "top_blocker_theme": the single weakness/threat theme with the largest evidence_count.
  - "top_blocker_calls": that theme's evidence_count.
  - "biggest_strength_theme": the single strength theme with the largest evidence_count.
  - "high_severity_count": total number of weakness OR threat OR function-improvement items where severity == "high".

────────────────────────────────────────────────────────────────────────────
Hard rules:
  - Output ONLY valid JSON, no fences, no surrounding prose.
  - "theme" max 12 words. "detail" max 2 sentences. "recommended_action" max 20 words.
  - "representative_quotes" must be verbatim strings drawn from the input partials' evidence.
  - "example_clean_numbers" entries must appear in the input partials' evidence Clean Number list. Never invent, guess, or pad.
  - Always emit ALL 5 function blocks (sales_team, marketing, supply_chain_and_delivery, product_team, omnichannel_team) — even if items is [].

Required JSON shape:
{{
  "strengths":     [{{ "theme": "...", "detail": "...", "severity": "low|medium|high",
                       "evidence_count": 0, "representative_quotes": ["...", "..."],
                       "example_clean_numbers": ["...", "..."] }}],
  "weaknesses":    [...same shape...],
  "opportunities": [...same shape...],
  "threats":       [...same shape...],
  "function_improvements": [
    {{ "function": "sales_team", "items": [
        {{ "function": "sales_team", "theme": "...", "detail": "...",
           "recommended_action": "...", "severity": "low|medium|high",
           "evidence_count": 0, "example_clean_numbers": ["..."] }}
    ]}},
    {{ "function": "marketing", "items": [...] }},
    {{ "function": "supply_chain_and_delivery", "items": [...] }},
    {{ "function": "product_team", "items": [...] }},
    {{ "function": "omnichannel_team", "items": [...] }}
  ],
  "quick_stats": {{
    "calls_analyzed": {n_total_calls},
    "top_blocker_theme": "...",
    "top_blocker_calls": 0,
    "biggest_strength_theme": "...",
    "high_severity_count": 0
  }},
  "notes":         "optional one-line caveat string or null"
}}
"""


def stage2_swot_prompt(store_name: str, partials: List[Dict[str, Any]], *, n_total_calls: int) -> str:
    """Call-1 of Stage-2: produces just the four SWOT lists with citations."""
    return (
        _STAGE2_SWOT_INSTRUCTIONS.format(
            store_name=store_name,
            n_partials=len(partials),
            n_total_calls=n_total_calls,
        )
        + "\n\nPartial SWOT extractions:\n"
        + json.dumps(partials, ensure_ascii=False, indent=2)
    )


def stage2_functions_prompt(store_name: str, partials: List[Dict[str, Any]], *, n_total_calls: int) -> str:
    """Call-2 of Stage-2: produces the 5 function-improvement blocks."""
    return (
        _STAGE2_FUNCTIONS_INSTRUCTIONS.format(
            store_name=store_name,
            n_partials=len(partials),
            n_total_calls=n_total_calls,
        )
        + "\n\nPartial SWOT extractions:\n"
        + json.dumps(partials, ensure_ascii=False, indent=2)
    )
