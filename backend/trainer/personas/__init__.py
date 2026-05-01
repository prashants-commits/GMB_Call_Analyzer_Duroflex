"""Persona Library (Group C).

Pipeline:
  1. Per-call signature extraction (Pro w/ response_schema)
  2. Single-shot cluster + synthesise (Pro reasons about all signatures and
     emits K personas with diversity built-in — replaces the original plan's
     numpy clustering + per-cluster synthesis with one cleaner Pro call)
  3. Diversity coverage check (numpy) + targeted top-up if cells are empty
  4. Persist as draft, admin reviews + publishes versioned library

The published library feeds Group D (mock-call engine) via ``picker.pick()``.
"""

from .schema import (
    Persona,
    PersonaLibrary,
    PersonaSignature,
    DifficultyBand,
    DecisionRole,
    LanguageMix,
    UrgencyProfile,
)
from .store import (
    list_drafts,
    list_published_versions,
    load_draft,
    load_published,
    save_draft,
    publish_draft,
)
from .picker import pick_persona, PickerError

__all__ = [
    "Persona",
    "PersonaLibrary",
    "PersonaSignature",
    "DifficultyBand",
    "DecisionRole",
    "LanguageMix",
    "UrgencyProfile",
    "list_drafts",
    "list_published_versions",
    "load_draft",
    "load_published",
    "save_draft",
    "publish_draft",
    "pick_persona",
    "PickerError",
]
