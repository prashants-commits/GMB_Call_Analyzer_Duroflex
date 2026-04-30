"""
Gemini API service for generating executive insight reports.
Uses google-genai SDK to call Gemini 3.1 Pro Preview.
"""

import os
import json
from dotenv import load_dotenv
from google import genai

load_dotenv()


def _sanitize_clean_numbers(report: dict, valid_numbers: set) -> dict:
    """
    Defensive validation: drop any example_clean_numbers that Gemini may have
    fabricated. Walks the report dict and filters out values not in valid_numbers.
    """
    if not isinstance(report, dict):
        return report

    def _filter_list(numbers):
        if not isinstance(numbers, list):
            return numbers
        return [n for n in numbers if str(n) in valid_numbers]

    def _walk(node):
        if isinstance(node, dict):
            for k, v in list(node.items()):
                if k == "example_clean_numbers":
                    node[k] = _filter_list(v)
                else:
                    _walk(v)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(report)
    return report


async def generate_insights(call_data: list, segment_description: str, date_range: str, custom_question: str = "",
                            call_data_b: list = None, segment_description_b: str = None, date_range_b: str = None) -> dict:
    """
    Send call data to Gemini and return a structured insights report.
    If call_data_b is provided, generates a Comparison Report.

    The prompt instructs Gemini to:
      - Cluster recurring themes from the qualitative text fields (free-form).
      - Rank themes by % of calls discussing them.
      - Cite 5 representative Clean Numbers per theme (calls where it's most prominent).
      - For custom questions, return a long-form first-principles analysis.
    """
    # Reload dotenv to catch any changes made while the server is running
    load_dotenv(override=True)
    api_key = os.getenv("GEMINI_API_KEY", "")

    if not api_key or api_key in ["YOUR_GEMINI_API_KEY_HERE", "your-gemini-api-key-here"]:
        raise ValueError("GEMINI_API_KEY is not configured or is invalid. Please set a valid key in backend/.env")

    client = genai.Client(api_key=api_key)

    # Collect valid clean_numbers up-front so we can sanitize Gemini's response.
    valid_numbers = {str(row.get("Clean Number", "")) for row in call_data if row.get("Clean Number")}
    if call_data_b:
        valid_numbers |= {str(row.get("Clean Number", "")) for row in call_data_b if row.get("Clean Number")}

    if call_data_b is not None:
        base_prompt = f"""Context: This is data from analysing inbound sales calls at Duroflex. You are being asked to compare two distinct segments of calls.

Dataset A (Segment: {segment_description} | Dates: {date_range}) - {len(call_data)} calls
Below is the call-level data for Dataset A in JSON format. Each row includes a "Clean Number" field (10-digit phone identifier) which you MUST use when citing example calls:
{json.dumps(call_data, ensure_ascii=False, indent=2)}

Dataset B (Segment: {segment_description_b} | Dates: {date_range_b}) - {len(call_data_b)} calls
Below is the call-level data for Dataset B in JSON format. Each row includes a "Clean Number" field which you MUST use when citing example calls:
{json.dumps(call_data_b, ensure_ascii=False, indent=2)}

You are an expert Data Analyst presenting to the CEO, CGO, and CSO. Your tone must be highly professional, structural, business-friendly, and actionable.

Analytical method:
  1. Read the qualitative text fields (Agent Good, Agent Bad, Brand Good, Brand Bad, Customer Needs, Purchase Barrier Detail, Store Visit Barrier Detail, Agent Learnings, Call Summary) across BOTH datasets.
  2. Cluster recurring themes. Themes are FREE-FORM — derive them from the actual language in the data, not predefined buckets.
  3. For each theme, COUNT how many calls (rows) discuss it (call_count) and compute the percentage of total calls in that dataset (call_percentage, rounded integer string like "23%"). Do this independently for Dataset A and Dataset B.
  4. Pick UP TO 5 representative Clean Numbers from the calls where the theme is MOST PROMINENT (most explicit, strongest language) within each dataset. If fewer than 5 calls discuss the theme, list all available — NEVER fabricate numbers.
  5. Apply a First Principles diagnostic approach: isolate the core parameters driving Brand Perception (e.g., product quality, pricing, trust) and Store/Staff Experience (e.g., knowledge, proactive probing, follow-up). Contrast Dataset A vs Dataset B on these isolated parameters.

Prepare an Executive Comparison Insights Report with these sections, EACH RANKED BY % OF CALLS (highest first within each dataset):

  1. Brand Analysis (Comparison) — Top 3 advantages/strengths. Contrast A vs B on isolated Brand parameters.
  2. Brand Vulnerabilities — Top 3 weaknesses. Contrast A vs B on isolated Brand parameters.
  3. Store & Staff Analysis (Comparison) — Top 3 advantages/strengths. Contrast A vs B on isolated Staff parameters.
  4. Store & Staff Vulnerabilities — Top 3 weaknesses. Contrast A vs B on isolated Staff parameters.
  5. Revenue Blockers & Next Steps — explicitly state what is stopping revenue growth in Dataset A vs Dataset B, then provide 3 to 5 actionable recommendations targeting the highest-volume blockers.

Hard rules:
  - "Top 3" means the 3 themes with the highest call_count for that section (use Dataset A counts to determine ordering when in doubt).
  - Every value in example_clean_numbers MUST be a Clean Number that appears in the input data above. NEVER invent numbers.
  - Themes appearing in fewer than 3 calls (~1% of N) should be excluded.
  - Aim for non-trivial, decision-grade insights — not tautologies.
"""
    else:
        base_prompt = f"""Context: This is data from analysing {len(call_data)} inbound sales calls at Duroflex.
Segment applied: {segment_description}
Date range: {date_range}

Below is the call-level data in JSON format. Each row includes a "Clean Number" field (10-digit phone identifier) which you MUST use when citing example calls:
{json.dumps(call_data, ensure_ascii=False, indent=2)}

You are an expert Data Analyst presenting to the CEO, CGO, and CSO. Your tone must be highly professional, structural, business-friendly, and actionable.

Analytical method:
  1. Read the qualitative text fields (Agent Good, Agent Bad, Brand Good, Brand Bad, Customer Needs, Purchase Barrier Detail, Store Visit Barrier Detail, Agent Learnings, Call Summary).
  2. Cluster recurring themes across calls. Themes are FREE-FORM — derive them from the actual language in the data, not predefined buckets.
  3. For each theme, COUNT how many calls (rows) discuss it (call_count) and compute the percentage of total calls (call_percentage, rounded integer string like "23%").
  4. Pick UP TO 5 representative Clean Numbers from the calls where the theme is MOST PROMINENT (most explicit, strongest language). If fewer than 5 calls discuss the theme, list all available — NEVER fabricate numbers.

Based ONLY on the provided data, prepare an Executive Insights Report with these sections, EACH RANKED BY % OF CALLS (highest first):

  1. Top 3 GOOD aspects about the BRAND
  2. Top 3 BAD aspects about the BRAND
  3. Top 3 GOOD aspects about the STORE & STAFF (agents)
  4. Top 3 BAD aspects about the STORE & STAFF (agents)
  5. 3 to 5 Overall NEXT STEPS — actionable recommendations that target the highest-volume bad themes from sections 2 and 4.

Hard rules:
  - "Top 3" means the 3 themes with the highest call_count for that section.
  - Every value in example_clean_numbers MUST be a Clean Number that appears in the input data above. NEVER invent numbers.
  - Themes appearing in fewer than 3 calls (~1% of N) should be excluded.
  - Aim for non-trivial, decision-grade insights — not tautologies.
"""

    # Append custom-question section + JSON schema spec
    has_custom = bool(custom_question and custom_question.strip())

    if has_custom:
        if call_data_b is not None:
            base_prompt += f"""
A custom question has been provided. Answer it with a deep, multi-paragraph First Principles analysis comparing Dataset A against Dataset B. Structure the answer as:
  - first_principles_analysis: 4 to 8 short paragraphs walking through the diagnostic reasoning from fundamentals (what structurally drives the outcome the user is asking about, then which of those drivers show signal in each dataset).
  - dataset_a_evidence: up to 5 supporting points for Dataset A, each with call_count, call_percentage, example_clean_numbers (max 5 each, all from Dataset A's input).
  - dataset_b_evidence: up to 5 supporting points for Dataset B, same structure.
  - comparative_synthesis: a closing paragraph directly contrasting the two and tying analysis to concrete, prioritized actions.

Custom Request/Question: {custom_question.strip()}

Format your response as a JSON object with this EXACT structure:
{{
  "brand_good": [
    {{
      "title": "...",
      "detail": "...",
      "dataset_a": {{ "call_count": 0, "call_percentage": "0%", "example_clean_numbers": [] }},
      "dataset_b": {{ "call_count": 0, "call_percentage": "0%", "example_clean_numbers": [] }}
    }}
  ],
  "brand_bad":  [{{...same shape...}}],
  "store_good": [{{...same shape...}}],
  "store_bad":  [{{...same shape...}}],
  "next_steps": [
    {{
      "title": "...",
      "detail": "...",
      "addresses_themes": ["..."],
      "dataset_a": {{ "call_count": 0, "call_percentage": "0%" }},
      "dataset_b": {{ "call_count": 0, "call_percentage": "0%" }}
    }}
  ],
  "custom_answer": {{
    "question": "...",
    "first_principles_analysis": "long-form analysis, 4-8 paragraphs separated by \\n\\n",
    "dataset_a_evidence": [
      {{ "insight": "...", "call_count": 0, "call_percentage": "0%", "example_clean_numbers": [] }}
    ],
    "dataset_b_evidence": [
      {{ "insight": "...", "call_count": 0, "call_percentage": "0%", "example_clean_numbers": [] }}
    ],
    "comparative_synthesis": "..."
  }}
}}
"""
        else:
            base_prompt += f"""
A custom question has been provided. Answer it with a deep, multi-paragraph First Principles analysis. Structure the answer as:
  - first_principles_analysis: 4 to 8 short paragraphs walking through the diagnostic reasoning from fundamentals — what structurally drives the outcome the user is asking about, then which of those drivers show signal in this dataset and why.
  - key_insights: up to 5 supporting points, each with call_count, call_percentage, example_clean_numbers (max 5 each, all from the input).
  - conclusion: a closing paragraph synthesizing the analysis into concrete, prioritized actions.

Custom Request/Question: {custom_question.strip()}

Format your response as a JSON object with this EXACT structure:
{{
  "brand_good": [
    {{
      "title": "...",
      "detail": "...",
      "call_count": 0,
      "call_percentage": "0%",
      "example_clean_numbers": []
    }}
  ],
  "brand_bad":  [{{...same shape...}}],
  "store_good": [{{...same shape...}}],
  "store_bad":  [{{...same shape...}}],
  "next_steps": [
    {{
      "title": "...",
      "detail": "...",
      "addresses_themes": ["..."],
      "call_count": 0,
      "call_percentage": "0%"
    }}
  ],
  "custom_answer": {{
    "question": "...",
    "first_principles_analysis": "long-form analysis, 4-8 paragraphs separated by \\n\\n",
    "key_insights": [
      {{ "insight": "...", "call_count": 0, "call_percentage": "0%", "example_clean_numbers": [] }}
    ],
    "conclusion": "..."
  }}
}}
"""
    else:
        if call_data_b is not None:
            base_prompt += """
Format your response as a JSON object with this EXACT structure:
{
  "brand_good": [
    {
      "title": "...",
      "detail": "...",
      "dataset_a": { "call_count": 0, "call_percentage": "0%", "example_clean_numbers": [] },
      "dataset_b": { "call_count": 0, "call_percentage": "0%", "example_clean_numbers": [] }
    }
  ],
  "brand_bad":  [{...same shape...}],
  "store_good": [{...same shape...}],
  "store_bad":  [{...same shape...}],
  "next_steps": [
    {
      "title": "...",
      "detail": "...",
      "addresses_themes": ["..."],
      "dataset_a": { "call_count": 0, "call_percentage": "0%" },
      "dataset_b": { "call_count": 0, "call_percentage": "0%" }
    }
  ]
}
"""
        else:
            base_prompt += """
Format your response as a JSON object with this EXACT structure:
{
  "brand_good": [
    {
      "title": "...",
      "detail": "...",
      "call_count": 0,
      "call_percentage": "0%",
      "example_clean_numbers": []
    }
  ],
  "brand_bad":  [{...same shape...}],
  "store_good": [{...same shape...}],
  "store_bad":  [{...same shape...}],
  "next_steps": [
    {
      "title": "...",
      "detail": "...",
      "addresses_themes": ["..."],
      "call_count": 0,
      "call_percentage": "0%"
    }
  ]
}
"""

    base_prompt += """
Return ONLY valid JSON. No markdown fences, no commentary outside the JSON.
Do NOT fabricate Clean Numbers. Every value in example_clean_numbers MUST appear in the input data above.
"""

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
        # Defensive: filter out any fabricated clean_numbers
        result = _sanitize_clean_numbers(result, valid_numbers)
    except json.JSONDecodeError:
        # Fallback: return the raw text for the frontend to display
        result = {
            "raw_text": raw_text,
            "parse_error": True
        }

    return result
