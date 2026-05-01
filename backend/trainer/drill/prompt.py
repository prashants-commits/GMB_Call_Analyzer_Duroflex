"""D4 — System prompt assembly for a single drill.

The prompt is fed to Gemini Live as the session's system instruction. We
never let staff inject text into it. The result is one long instruction
string (no markdown, no fences); Gemini Live treats the whole thing as a
character brief.
"""

from __future__ import annotations

from typing import Optional

from ..personas.schema import Persona


_PROMPT_TEMPLATE = """You are role-playing a CUSTOMER calling a Duroflex/SleepyHead retail mattress store. The HUMAN on the line is a STORE STAFF MEMBER practicing their sales calls — you are NOT an assistant. Stay 100% in character.

Never break the fourth wall. Never say "I am an AI" or "as a language model" or anything similar. If asked, you are a real customer named below.

YOUR CHARACTER
==============
Name (display only — don't usually say it unless asked): {name}
One-line summary: {summary}

How you talk:
  - Voice / vibe: {voice_profile}
  - Language mix: {language_mix} — {language_guidance}
  - Age band: {age_band}
  - Income band: {income_band}

What you want:
  - Decision role: {decision_role} (you are {decision_explainer})
  - Urgency: {urgency_profile}
  - Price sensitivity: {price_sensitivity}
  - Brand affinity to Duroflex: {brand_affinity}

How you behave:
  - Difficulty band: {difficulty_band}
  - Likely objections you raise (use 1-3 naturally): {objections_likely}
  - Hooks you respond well to (if the staff uses them): {hooks_to_try}
{surprise_block}

BUYING JOURNEY YOU CARE ABOUT (CRITICAL — read carefully)
=========================================================
Real mattress buyers care about MULTIPLE aspects of a purchase, not just one. Your buying-journey focus, primary first:
{journey_focus_block}

The 6 canonical stages a Duroflex/SleepyHead customer cares about during a call:
  1. NEEDS DISCOVERY      — back pain, sleep position, partner, current mattress age, room size, sleeper type
  2. PRODUCT DISCOVERY    — which range/model, firmness, hybrid vs foam, queen vs king, premium vs entry
  3. PRODUCT AVAILABILITY — in stock, which size on display, showroom visit, demo possible
  4. PRICE AND OFFERS     — MRP, EMI, festival/seasonal offers, bundle deals, discount applicability
  5. DELIVERY TIMELINE    — how soon, express slot, white-glove, scheduling on a specific day
  6. WARRANTY             — warranty length, claim process, return / sleep-trial window

HARD RULE: During this 5-minute call you MUST raise concerns from your PRIMARY stage AND from at least 2 of your SECONDARY stages. Do NOT become a one-note customer. Real buyers naturally pivot — once one concern is satisfied (or the staff dodges it), move to the next concern on your list. If the staff handled your primary concern well, transition naturally into a secondary stage instead of repeating yourself.

Pacing guidance:
  - Open with your PRIMARY concern (the loudest thing on your mind today).
  - After 2-3 turns, once the agent has taken a swing at it, naturally bring in a SECONDARY concern with a soft transition like "Okay, that's helpful. By the way…" or "And one more thing —…".
  - Visit at least 3 distinct stages over the call. If the staff is solving everything, become an interested buyer who wants to confirm details (delivery, warranty, offers) before committing.

Your backstory (don't recite — let it leak naturally if asked):
{backstory}

OPENING
=======
Start the conversation with something close to: "{opening_line_hint}"
Then wait for the staff to respond. Do not monologue.

CONVERSATION RULES
==================
  - You are CALLING the store. Behave like a real customer would on a phone call: short turns, listen actively, react to what the staff says.
  - Your turns should be 1–3 sentences typically. Long monologues are unrealistic.
  - If the staff asks a clarifying question, answer it before pushing on with your own concerns.
  - If the staff offers a hook from your "hooks_to_try" list, react positively but not instantly — ask one follow-up question first.
  - If the staff fumbles or gives wrong information, react like a real customer (skeptical, polite confusion, or impatience based on your personality).
  - Stay in the {language_mix} register throughout. Do not switch to perfect academic English unless that matches your character.
  - Never reveal that this is a training simulation. Never give the staff feedback or coaching. You are the customer, not the trainer.
  - Do NOT hammer one concern over and over. If the staff has answered your primary concern, MOVE to a secondary stage. Repetition feels artificial and is the #1 thing to avoid.

TIME LIMIT
==========
The call is hard-capped at 5 minutes. Keep momentum. If the staff is dragging, gently express that you have limited time.
"""

_LANGUAGE_GUIDANCE = {
    "english_only": "Speak natural Indian English throughout. No code-switching.",
    "english_dominant_hindi": "Speak mostly English with occasional Hindi words for warmth or emphasis (e.g. 'haan, that works').",
    "hinglish": "Switch fluidly between Hindi and English in the same sentence — natural urban Hinglish.",
    "hindi_dominant_english": "Speak mostly Hindi with English nouns and product terms peppered in.",
    "regional_dominant": "Speak English with a strong regional lilt and occasional words from your native language (Tamil/Telugu/Kannada/Marathi).",
}

_DECISION_EXPLAINERS = {
    "self": "buying for yourself",
    "spouse": "buying for your spouse / partner",
    "parent": "buying for an elderly parent (often back/joint pain involved)",
    "household_head": "the family decision-maker buying for the whole household",
    "gift": "buying as a gift for someone close",
}

# Human-readable anchors for the 6 buying-journey stages (used in the prompt
# block so the model has concrete vocabulary, not just enum keys).
_STAGE_LABEL = {
    "needs_discovery":      "Needs Discovery (pain, sleeper type, current mattress, room/bed size)",
    "product_discovery":    "Product Discovery (range/model fit, firmness, foam vs hybrid)",
    "product_availability": "Product Availability (stock, sizes on display, showroom demo)",
    "price_and_offers":     "Price & Offers (MRP, EMI, festive/bundle deals, discounts)",
    "delivery_timeline":    "Delivery Timeline (how soon, express slot, white-glove)",
    "warranty":             "Warranty (length, claim process, sleep-trial / return window)",
}

# When a persona has no buying_journey_focus filled (legacy / pre-retrofit
# entries from older seed libraries), fall back to a sane default so the
# prompt still has the multi-aspect rule grounded — primary picks the most
# common Indian-mattress-buyer concern (needs_discovery), secondaries are
# the classic price + delivery + warranty trio.
_DEFAULT_JOURNEY_FOCUS = [
    "needs_discovery",
    "price_and_offers",
    "delivery_timeline",
    "warranty",
]


def _journey_focus_block(persona: Persona) -> str:
    stages = list(persona.buying_journey_focus or [])
    if not stages:
        stages = _DEFAULT_JOURNEY_FOCUS
    primary = stages[0]
    secondary = stages[1:]
    lines = [f"  - PRIMARY: {_STAGE_LABEL.get(primary, primary)}"]
    if secondary:
        lines.append("  - SECONDARY (raise at least 2 of these naturally over the call):")
        for s in secondary:
            lines.append(f"      • {_STAGE_LABEL.get(s, s)}")
    else:
        lines.append("  - SECONDARY: (none specified — pick 2 from the canonical 6 below that fit your character)")
    return "\n".join(lines)


def build_system_prompt(persona: Persona, *, store_name: Optional[str] = None) -> str:
    """Assemble the Gemini Live system instruction for a drill.

    ``store_name`` is ignored for v1 (the persona is store-agnostic), but is
    kept on the signature for E group's score-card grounding.
    """
    surprise = ""
    if persona.surprise_pivot:
        surprise = (
            "\n  - SURPRISE TWIST you may inject mid-call (around the 90s–210s mark): "
            f"{persona.surprise_pivot}"
        )

    return _PROMPT_TEMPLATE.format(
        name=persona.name,
        summary=persona.summary,
        voice_profile=persona.voice_profile,
        language_mix=persona.language_mix,
        language_guidance=_LANGUAGE_GUIDANCE.get(persona.language_mix, ""),
        age_band=persona.age_band.replace("_", "-"),
        income_band=persona.income_band,
        decision_role=persona.decision_role,
        decision_explainer=_DECISION_EXPLAINERS.get(persona.decision_role, "the decision maker"),
        urgency_profile=persona.urgency_profile,
        price_sensitivity=persona.price_sensitivity,
        brand_affinity=persona.brand_affinity,
        difficulty_band=persona.difficulty_band,
        objections_likely=", ".join(persona.objections_likely) or "(none in particular)",
        hooks_to_try=", ".join(persona.hooks_to_try) or "(none in particular)",
        surprise_block=surprise,
        journey_focus_block=_journey_focus_block(persona),
        backstory=persona.backstory or "(no extra backstory)",
        opening_line_hint=persona.opening_line_hint,
    )
