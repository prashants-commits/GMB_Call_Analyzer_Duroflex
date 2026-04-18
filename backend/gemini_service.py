"""
Gemini API service for generating executive insight reports.
Uses google-genai SDK to call Gemini 3.1 Pro Preview.
"""

import os
import json
from dotenv import load_dotenv
from google import genai

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

PROMPT_TEMPLATE = """Context: This is data from analysing {n_calls} inbound sales calls at Duroflex.
Segment applied: {segment_description}
Date range: {date_range}

Below is the call-level data in JSON format:
{call_data_json}

Prepare an Executive-level, simple and effective Report for the CEO and CGO containing:

1. **Top 3 Good Aspects about the Brand** — with brief supporting evidence from the calls
2. **Top 3 Bad Aspects about the Brand** — with brief supporting evidence from the calls
3. **Top 3 Good Aspects about the Store & Staff** — with brief supporting evidence from the calls
4. **Top 3 Bad Aspects about the Store & Staff** — with brief supporting evidence from the calls
5. **Top 3 to 5 Overall Next Steps** to improve Business and Customer Experience — actionable recommendations

Format your response as a JSON object with this exact structure:
{{
  "brand_good": [{{"title": "...", "detail": "..."}}, ...],
  "brand_bad": [{{"title": "...", "detail": "..."}}, ...],
  "store_good": [{{"title": "...", "detail": "..."}}, ...],
  "store_bad": [{{"title": "...", "detail": "..."}}, ...],
  "next_steps": [{{"title": "...", "detail": "..."}}, ...]
}}

Return ONLY valid JSON. No markdown fences, no commentary outside the JSON."""


async def generate_insights(call_data: list, segment_description: str, date_range: str) -> dict:
    """
    Send call data to Gemini and return a structured insights report.
    
    Args:
        call_data: List of dicts, each containing the specified columns for one call.
        segment_description: Human-readable description of the applied filters.
        date_range: Human-readable date range string.
    
    Returns:
        Parsed JSON dict with brand_good, brand_bad, store_good, store_bad, next_steps.
    
    Raises:
        ValueError: If API key is missing or Gemini returns unparseable output.
    """
    if not GEMINI_API_KEY or GEMINI_API_KEY == "YOUR_GEMINI_API_KEY_HERE":
        raise ValueError("GEMINI_API_KEY is not configured. Please set it in backend/.env")

    client = genai.Client(api_key=GEMINI_API_KEY)

    prompt = PROMPT_TEMPLATE.format(
        n_calls=len(call_data),
        segment_description=segment_description,
        date_range=date_range,
        call_data_json=json.dumps(call_data, ensure_ascii=False, indent=2)
    )

    response = client.models.generate_content(
        model="gemini-3.1-pro-preview",
        contents=prompt
    )

    raw_text = response.text.strip()

    # Strip markdown fences if model wraps them anyway
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        # Remove first and last lines (```json and ```)
        lines = [l for l in lines if not l.strip().startswith("```")]
        raw_text = "\n".join(lines)

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError:
        # Fallback: return the raw text for the frontend to display
        result = {
            "raw_text": raw_text,
            "parse_error": True
        }

    return result
