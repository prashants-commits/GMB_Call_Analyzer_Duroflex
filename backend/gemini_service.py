"""
Gemini API service for generating executive insight reports.
Uses google-genai SDK to call Gemini 3.1 Pro Preview.
"""

import os
import json
from dotenv import load_dotenv
from google import genai

load_dotenv()

async def generate_insights(call_data: list, segment_description: str, date_range: str, custom_question: str = "",
                            call_data_b: list = None, segment_description_b: str = None, date_range_b: str = None) -> dict:
    """
    Send call data to Gemini and return a structured insights report.
    If call_data_b is provided, generates a Comparison Report.
    """
    # Reload dotenv to catch any changes made while the server is running
    load_dotenv(override=True)
    api_key = os.getenv("GEMINI_API_KEY", "")
    
    if not api_key or api_key in ["YOUR_GEMINI_API_KEY_HERE", "your-gemini-api-key-here"]:
        raise ValueError("GEMINI_API_KEY is not configured or is invalid. Please set a valid key in backend/.env")

    client = genai.Client(api_key=api_key)

    if call_data_b is not None:
        base_prompt = f"""Context: This is data from analysing inbound sales calls at Duroflex. You are being asked to compare two distinct segments of calls.

Dataset A (Segment: {segment_description} | Dates: {date_range}) - {len(call_data)} calls
Below is the call-level data for Dataset A in JSON format:
{json.dumps(call_data, ensure_ascii=False, indent=2)}

Dataset B (Segment: {segment_description_b} | Dates: {date_range_b}) - {len(call_data_b)} calls
Below is the call-level data for Dataset B in JSON format:
{json.dumps(call_data_b, ensure_ascii=False, indent=2)}

You are an expert Data Analyst presenting to the CEO, CGO, and CSO. Your tone should be highly professional, structural, business-friendly, and actionable.

Based ONLY on the provided call data, prepare an Executive Comparison Insights Report by applying a First Principles diagnostic approach:
First, isolate the core parameters driving Brand Perception (e.g., product quality, pricing, trust) and Store/Staff Experience (e.g., knowledge, proactive probing, follow-up).
Second, evaluate and contrast Dataset A vs Dataset B across these exact parameters.
Third, identify the root causes actively stopping revenue growth in each dataset.

Your report must populate the following sections:
1. **Brand Analysis (Comparison)** — Contrast A vs B on isolated Brand parameters. Provide the Top 3 advantages/strengths.
2. **Brand Vulnerabilities** — Contrast A vs B on isolated Brand parameters. Provide the Top 3 weaknesses.
3. **Store & Staff Analysis (Comparison)** — Contrast A vs B on isolated Staff parameters (probing, knowledge, etc.). Provide the Top 3 advantages/strengths.
4. **Store & Staff Vulnerabilities** — Contrast A vs B on isolated Staff parameters. Provide the Top 3 weaknesses.
5. **Revenue Blockers & Next Steps** — First, explicitly state what is stopping revenue growth in Dataset A vs Dataset B. Then, provide 3 to 5 actionable recommendations to overcome these exact blockers.
"""
    else:
        base_prompt = f"""Context: This is data from analysing {len(call_data)} inbound sales calls at Duroflex.
Segment applied: {segment_description}
Date range: {date_range}

Below is the call-level data in JSON format:
{json.dumps(call_data, ensure_ascii=False, indent=2)}

You are an expert Data Analyst presenting to the CEO, CGO, and CSO. Your tone should be highly professional, structural, business-friendly, and actionable.

Based ONLY on the provided call data, prepare an Executive Insights Report containing:

1. **Top 3 Good Aspects about the Brand** — with brief supporting evidence from the calls
2. **Top 3 Bad Aspects about the Brand** — with brief supporting evidence from the calls
3. **Top 3 Good Aspects about the Store & Staff** — with brief supporting evidence from the calls
4. **Top 3 Bad Aspects about the Store & Staff** — with brief supporting evidence from the calls
5. **Top 3 to 5 Overall Next Steps** to improve Business and Customer Experience — actionable recommendations
"""

    if custom_question and custom_question.strip():
        if call_data_b is not None:
            base_prompt += f"6. **Custom Request/Question:** Please answer this question by contrasting Dataset A against Dataset B: {custom_question.strip()}\n\n"
        else:
            base_prompt += f"6. **Custom Request/Question:** {custom_question.strip()}\n\n"
        base_prompt += """Format your response as a JSON object with this exact structure:
{
  "brand_good": [{"title": "...", "detail": "..."}],
  "brand_bad": [{"title": "...", "detail": "..."}],
  "store_good": [{"title": "...", "detail": "..."}],
  "store_bad": [{"title": "...", "detail": "..."}],
  "next_steps": [{"title": "...", "detail": "..."}],
  "custom_answer": {
    "question": "...",
    "answer_points": [{"title": "...", "detail": "..."}]
  }
}"""
    else:
        base_prompt += """Format your response as a JSON object with this exact structure:
{
  "brand_good": [{"title": "...", "detail": "..."}],
  "brand_bad": [{"title": "...", "detail": "..."}],
  "store_good": [{"title": "...", "detail": "..."}],
  "store_bad": [{"title": "...", "detail": "..."}],
  "next_steps": [{"title": "...", "detail": "..."}]
}"""

    base_prompt += "\n\nReturn ONLY valid JSON. No markdown fences, no commentary outside the JSON."

    response = client.models.generate_content(
        model="gemini-3.1-pro-preview",
        contents=base_prompt
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
