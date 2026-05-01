"""Thin wrapper around the existing google-genai SDK for SWOT prompts.

We share a single ``genai.Client`` per process. The base app's
``gemini_service.py`` builds its own client per request — that's fine for the
existing endpoint but wasteful for SWOT, which fans out 5 parallel calls per
generation. Reusing one client also keeps connection-pooled HTTP cheap.

Cost computation uses the response's ``usage_metadata`` when available; if the
SDK doesn't surface it (older versions, mocked tests), we fall back to a 0
estimate rather than failing the whole pipeline.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from typing import Any, Optional

from dotenv import load_dotenv

logger = logging.getLogger("trainer.swot.gemini")

_client = None
_client_lock = threading.Lock()


class GeminiNotConfigured(RuntimeError):
    pass


def get_client():
    """Lazy module-level google-genai client. Raises ``GeminiNotConfigured``
    if ``GEMINI_API_KEY`` is missing."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        load_dotenv(override=True)
        api_key = os.getenv("GEMINI_API_KEY", "")
        if not api_key or api_key in {"YOUR_GEMINI_API_KEY_HERE", "your-gemini-api-key-here"}:
            raise GeminiNotConfigured(
                "GEMINI_API_KEY is not set. SWOT generation needs a valid Gemini key in backend/.env"
            )
        from google import genai  # imported lazily so module import doesn't require it
        _client = genai.Client(api_key=api_key)
        return _client


@dataclass
class GeminiCall:
    """Result of a single Gemini call: the raw text + usage metadata."""

    text: str
    input_tokens: int
    output_tokens: int

    def cost_inr(self, in_rate_per_1m: float, out_rate_per_1m: float) -> float:
        return (self.input_tokens / 1_000_000) * in_rate_per_1m + (
            self.output_tokens / 1_000_000
        ) * out_rate_per_1m


def call_text_model(
    model: str,
    prompt: str,
    *,
    response_schema: Optional[type] = None,
    max_output_tokens: Optional[int] = None,
    thinking_budget: Optional[int] = None,
) -> GeminiCall:
    """Run a one-shot text completion. Returns the stripped response + usage.

    If ``response_schema`` is provided, the call uses structured output mode
    (``response_mime_type='application/json'`` + ``response_schema=...``).
    The model is then forced to emit JSON conforming to that Pydantic class,
    eliminating the markdown-fence and stray-quote failure modes.

    ``max_output_tokens`` overrides the default cap; needed for prompts that
    can produce long structured output.

    ``thinking_budget`` controls Pro's chain-of-thought reasoning — these
    "thinking" tokens count against ``max_output_tokens`` on Gemini 2.5+ /
    3.x. For mostly-mechanical structured-output tasks (like SWOT synthesis)
    set this to 0 or a small number to free up budget for the actual response.
    Pass ``-1`` for the SDK default (dynamic thinking).
    """
    client = get_client()

    from google.genai import types  # imported lazily

    config_kwargs = {}
    if response_schema is not None:
        config_kwargs["response_mime_type"] = "application/json"
        config_kwargs["response_schema"] = response_schema
    if max_output_tokens is not None:
        config_kwargs["max_output_tokens"] = int(max_output_tokens)
    if thinking_budget is not None:
        try:
            config_kwargs["thinking_config"] = types.ThinkingConfig(
                thinking_budget=int(thinking_budget),
            )
        except (AttributeError, TypeError):
            # Older SDK versions without ThinkingConfig — silently skip; the
            # call still works just without explicit budget control.
            logger.debug("ThinkingConfig unavailable; skipping thinking_budget=%s", thinking_budget)

    config = types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

    resp = client.models.generate_content(model=model, contents=prompt, config=config)

    text = (resp.text or "").strip()

    in_tok = 0
    out_tok = 0
    usage = getattr(resp, "usage_metadata", None)
    if usage is not None:
        in_tok = int(getattr(usage, "prompt_token_count", 0) or 0)
        out_tok = int(getattr(usage, "candidates_token_count", 0) or 0)

    if not text:
        logger.warning("Gemini returned empty text for model=%s; usage=%s/%s", model, in_tok, out_tok)

    return GeminiCall(text=text, input_tokens=in_tok, output_tokens=out_tok)


def strip_json_fences(text: str) -> str:
    """Remove markdown ```json fences if the model wrapped its JSON. Idempotent."""
    if not text:
        return text
    t = text.strip()
    if t.startswith("```"):
        lines = [l for l in t.split("\n") if not l.strip().startswith("```")]
        t = "\n".join(lines).strip()
    return t
