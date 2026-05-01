"""Pydantic schemas for the persona library.

Three nested layers:
  - PersonaSignature  — extracted from a single call's transcript (12 fields)
  - Persona            — synthesised, customer-facing role-play character
  - PersonaLibrary     — versioned wrapper around a list of Personas

Strict validation. The Stage-2 synthesis fails loudly if the model returns
out-of-enum values; that's better than a silently broken library.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ── Enums (string Literals so Gemini's structured output infers them cleanly) ─

LanguageMix = Literal[
    "english_only",
    "english_dominant_hindi",
    "hinglish",
    "hindi_dominant_english",
    "regional_dominant",  # e.g. Tamil/Telugu/Kannada/Marathi-leading
]

DifficultyBand = Literal["easy", "medium", "hard"]

DecisionRole = Literal[
    "self",          # buying for self
    "spouse",        # buying for spouse / partner
    "parent",        # buying for parents (often elderly back/joint pain)
    "household_head",
    "gift",
]

AgeBand = Literal["18_25", "26_35", "36_45", "46_55", "56_plus"]

GenderHint = Literal["male", "female", "unknown"]

IncomeBand = Literal["budget", "mid", "premium", "luxury"]

UrgencyProfile = Literal["low", "medium", "high"]

PriceSensitivity = Literal["low", "medium", "high"]

BrandRecallStrength = Literal["none", "weak", "strong", "loyalist"]

VoiceProfile = Literal[
    "calm_polite",
    "warm_chatty",
    "rushed_impatient",
    "skeptical_probing",
    "elderly_slower",
    "hinglish_casual",
    "south_indian_english_lilt",
]

# The six canonical stages of a Duroflex/SleepyHead buying journey. A persona
# always has a PRIMARY stage they care most about and 2-3 SECONDARY stages
# they will also raise during the 5-minute call. This stops the AI customer
# from being a one-note caller (e.g. only talking about disposal or delivery
# and ignoring everything else). The list is ordered primary-first.
BuyingStage = Literal[
    "needs_discovery",       # back pain, sleep partner, mattress age, room size
    "product_discovery",     # which range/model fits, firmness, hybrid vs foam
    "product_availability",  # is it in stock, which size, showroom display
    "price_and_offers",      # MRP, EMI, festival offers, bundle deals
    "delivery_timeline",     # how soon, express slot, white-glove
    "warranty",              # warranty length, claim process, return window
]


# ── PersonaSignature (per-call) ─────────────────────────────────────────────


class PersonaSignature(BaseModel):
    """12 fields extracted from a single analyzed call's qualitative content.

    Used as input to the cluster+synthesise step. We deliberately keep types
    tight (Literals + tuples) so the downstream cluster step can compute
    weighted-Hamming distances without messy string normalisation.
    """

    model_config = ConfigDict(extra="ignore")

    clean_number: str = Field(..., description="Source call identifier (10-digit phone)")
    language: LanguageMix
    regional_origin: str = Field("", max_length=40, description="Best-guess city or region")
    gender_hint: GenderHint = "unknown"
    age_band: AgeBand
    income_band: IncomeBand
    brand_recall_strength: BrandRecallStrength
    product_pref_keywords: List[str] = Field(default_factory=list, max_length=6)
    urgency: UrgencyProfile
    price_sensitivity: PriceSensitivity
    decision_role: DecisionRole
    objections_emitted: List[str] = Field(default_factory=list, max_length=8)
    hooks_responded_to: List[str] = Field(default_factory=list, max_length=6)


# ── Persona (synthesised role-play target) ──────────────────────────────────


class Persona(BaseModel):
    """A drillable customer persona. Drives the Gemini Live system prompt in D4."""

    model_config = ConfigDict(extra="ignore")

    persona_id: str = Field(..., description="Stable opaque id, e.g. 'P-elderly-back-pain-budget'")
    name: str = Field(..., description="Friendly display name, e.g. 'Anand, the Cautious Parent-Buyer'")
    summary: str = Field(..., max_length=400, description="1-2 sentence character snapshot")
    opening_line_hint: str = Field(..., max_length=200, description="What they're likely to say first")

    language_mix: LanguageMix
    voice_profile: VoiceProfile
    age_band: AgeBand
    gender_hint: GenderHint = "unknown"
    income_band: IncomeBand

    decision_role: DecisionRole
    urgency_profile: UrgencyProfile
    price_sensitivity: PriceSensitivity
    brand_affinity: BrandRecallStrength

    difficulty_band: DifficultyBand
    target_skill_focus: List[str] = Field(
        ..., min_length=1, max_length=4,
        description="Skills the agent must demonstrate. Drawn from: needs_discovery, "
                    "objection_handling, probing, hooks_and_offers, follow_up_capture, "
                    "product_pivoting, empathy_and_tone, closing",
    )

    objections_likely: List[str] = Field(default_factory=list, max_length=6)
    hooks_to_try: List[str] = Field(default_factory=list, max_length=6)
    surprise_pivot: Optional[str] = Field(
        None, max_length=300,
        description="A mid-call twist the AI customer may inject "
                    "(e.g. 'asks about delivery for a different city')",
    )

    # First entry = the PRIMARY aspect they care most about; the rest are
    # SECONDARY aspects they will also raise organically during the call.
    # Default empty for backward-compat with legacy seed-library entries that
    # predate this field; the system_prompt builder falls back to a sensible
    # default coverage instruction when empty.
    buying_journey_focus: List[BuyingStage] = Field(
        default_factory=list,
        max_length=6,
        description=(
            "Primary + 2-3 secondary stages of the buying journey this customer "
            "will raise during the call. Primary first."
        ),
    )

    backstory: str = Field("", max_length=600, description="Optional richer backstory for D4 prompt")


# ── PersonaLibrary (versioned wrapper) ──────────────────────────────────────


class PersonaLibrary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    version: int = Field(..., ge=1)
    status: Literal["draft", "published"] = "draft"
    generated_at: datetime
    source_call_count: int = Field(..., ge=0)
    model_signature: str = Field(..., description="Model used for per-call signatures")
    model_synthesis: str = Field(..., description="Model used for cluster+synthesise")
    cost_inr: float = Field(0.0, ge=0)
    notes: Optional[str] = None

    personas: List[Persona] = Field(default_factory=list)


# ── Stage-2 synthesis output (model-facing, just the personas list) ─────────


class SynthesisOutput(BaseModel):
    """What the synthesis model returns. Wrapped into PersonaLibrary by code."""

    model_config = ConfigDict(extra="ignore")
    personas: List[Persona] = Field(..., min_length=1)
    notes: Optional[str] = None
