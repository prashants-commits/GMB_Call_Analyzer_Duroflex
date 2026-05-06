"""
CSV Parser for GMB Calls Analyzer v3.
Reads the CSV at startup and builds an in-memory data store.
"""

import csv
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

CSV_PATH = Path(__file__).resolve().parent / "GMB Calls Analyzer - Call details (sample).csv"

# ── Score conversion helpers ─────────────────────────────────────────────────

def score_to_label(val: Any) -> str:
    """Convert numeric score (1-3/5) to HIGH/MEDIUM/LOW."""
    try:
        n = int(val)
    except (ValueError, TypeError):
        return str(val) if val else "N/A"
    if n >= 3:
        return "HIGH"
    if n == 2:
        return "MEDIUM"
    return "LOW"


def purchase_score_to_label(val: Any) -> str:
    """Convert purchase score (1-5) to HIGH/MEDIUM/LOW."""
    try:
        n = int(val)
    except (ValueError, TypeError):
        return str(val) if val else "N/A"
    if n == 5:
        return "HIGH"
    if n in (3, 4):
        return "MEDIUM"
    return "LOW"


def nps_to_label(val: Any) -> str:
    """Convert NPS (1-10) to HIGH/MEDIUM/LOW."""
    try:
        n = int(val)
    except (ValueError, TypeError):
        return "N/A"
    if n >= 8:
        return "HIGH"
    if n >= 5:
        return "MEDIUM"
    return "LOW"


def safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def safe_str(val: Any) -> str:
    return str(val).strip() if val else ""


def parse_call_date(val: Any) -> tuple[int, int, int]:
    """Parse a DD-MM-YYYY call_date string to a (year, month, day) tuple.

    Used as a sort key — invalid/empty values sort before all real dates.
    """
    s = safe_str(val)
    if not s:
        return (0, 0, 0)
    parts = s.split("-")
    if len(parts) != 3:
        return (0, 0, 0)
    try:
        d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
    except (ValueError, TypeError):
        return (0, 0, 0)
    return (y, m, d)


# ── Transcript parser ────────────────────────────────────────────────────────

_TRANSCRIPT_RE = re.compile(
    r"\[(\d{2}:\d{2})\]\s*(Agent|Customer):\s*(.+?)(?=\s*\[\d{2}:\d{2}\]|$)",
    re.DOTALL,
)


def parse_transcript(raw: str) -> List[Dict[str, str]]:
    """Parse transcript text into list of {speaker, text, timestamp}."""
    if not raw:
        return []
    messages = []
    for match in _TRANSCRIPT_RE.finditer(raw):
        timestamp, speaker, text = match.groups()
        messages.append({
            "timestamp": timestamp,
            "speaker": speaker,
            "text": text.strip(),
        })
    # Fallback: if regex caught nothing, split by newline patterns
    if not messages and raw.strip():
        for line in raw.strip().split("\n"):
            line = line.strip()
            m = re.match(r"\[(\d{2}:\d{2})\]\s*(Agent|Customer):\s*(.+)", line)
            if m:
                messages.append({
                    "timestamp": m.group(1),
                    "speaker": m.group(2),
                    "text": m.group(3).strip(),
                })
    return messages


# ── Row → structured JSON builder ────────────────────────────────────────────

def _build_call_detail(row: Dict[str, str]) -> Dict[str, Any]:
    """Convert a flat CSV row dict into the nested JSON structure for the detail page."""
    return {
        "identity": {
            "clean_number": safe_str(row.get("CleanNumber")),
            "brand": safe_str(row.get("Brand")),
            "store_name": safe_str(row.get("Store Name")),
            "locality": safe_str(row.get("Locality")),
            "city": safe_str(row.get("City")),
            "state": safe_str(row.get("State")),
            "call_date": safe_str(row.get("CallDateTime")),
            "duration": safe_int(row.get("Duration")),
            "recording_url": safe_str(row.get("Recording URL")),
            "call_type": safe_str(row.get("Call Type")),
        },
        "customer_metadata": {
            "name": safe_str(row.get("MetaData_Customer_Name")),
            "location": safe_str(row.get("MetaData_Customer_Location")),
            "language": safe_str(row.get("MetaData_Customer_Language")),
            "gender": safe_str(row.get("MetaData_Customer_Gender")),
            "age_group": safe_str(row.get("MetaData_Customer_Age_Group")),
            "income_group": safe_str(row.get("MetaData_Customer_Income_Group")),
            "persona": safe_str(row.get("MetaData_Customer_Persona")),
            "decision_maker": safe_str(row.get("9_Decision_Maker")),
        },
        "summary_signals": {
            "call_quality": score_to_label(row.get("MetaData_Call_Quality_Overall")),
            "call_quality_raw": safe_int(row.get("MetaData_Call_Quality_Overall")),
            "enthusiasm": score_to_label(row.get("MetaData_Customer_Enthusiasm")),
            "enthusiasm_raw": safe_int(row.get("MetaData_Customer_Enthusiasm")),
            "is_converted": safe_str(row.get("is_Converted")),
            "revenue": safe_str(row.get("Revenue")),
            "call_summary": safe_str(row.get("Call_Summary")),
        },
        "call_objective": {
            "type": safe_str(row.get("1_Call_Objective_Type")),
            "primary_inquiry": safe_str(row.get("1_Call_Objective_Primary_Inquiry")),
            "reason": safe_str(row.get("1_Call_Objective_Type_Reason")),
        },
        "intent": {
            "visit_rating": score_to_label(row.get("2_Intent_to_Visit_Store_Rating")),
            "visit_rating_raw": safe_int(row.get("2_Intent_to_Visit_Store_Rating")),
            "visit_reason": safe_str(row.get("2_Intent_to_Visit_Store_Reason")),
            "purchase_score": purchase_score_to_label(row.get("5_Purchase_Readiness_Score")),
            "purchase_score_raw": safe_int(row.get("5_Purchase_Readiness_Score")),
            "purchase_evidence": safe_str(row.get("5_Purchase_Readiness_Scoring_Evidence")),
        },
        "experience": {
            "agent": {
                "nps": safe_int(row.get("3a_Customer_Experience_Agent_NPS")),
                "rating": nps_to_label(row.get("3a_Customer_Experience_Agent_NPS")),
                "reason": safe_str(row.get("3a_Customer_Experience_Agent_NPS_Reason")),
                "good": safe_str(row.get("3a_Customer_Experience_Agent_Good")),
                "bad": safe_str(row.get("3a_Customer_Experience_Agent_Bad")),
            },
            "brand": {
                "nps": safe_int(row.get("3b_Customer_Experience_Brand_NPS")),
                "rating": nps_to_label(row.get("3b_Customer_Experience_Brand_NPS")),
                "reason": safe_str(row.get("3b_Customer_Experience_Brand_NPS_Reason")),
                "good": safe_str(row.get("3b_Customer_Experience_Brand_Good")),
                "bad": safe_str(row.get("3b_Customer_Experience_Brand_Bad")),
            },
        },
        "funnel": {
            "stage": safe_str(row.get("4_Funnel_Analysis_Stage")),
            "reason": safe_str(row.get("4_Funnel_Analysis_Reason")),
            "timeline": safe_str(row.get("4_Funnel_Analysis_Timeline_to_Purchase")),
            "timeline_reason": safe_str(row.get("4_Funnel_Analysis_Timeline_to_Purchase_Reason")),
            "follow_up_priority": safe_str(row.get("5_Purchase_Readiness_Follow_Up_Priority")),
        },
        "product_intelligence": {
            "category": safe_str(row.get("6_Product_Intelligence_Category")),
            "sub_category": safe_str(row.get("6_Product_Intelligence_Sub_Category")),
            "collection": safe_str(row.get("6_Product_Intelligence_Collection")),
            "verbatim": safe_str(row.get("6_Product_Intelligence_Customer_Verbatim_Product")),
            "narrow_down_stage": safe_str(row.get("6_Product_Intelligence_Narrow_Down_Stage")),
            "order_value": safe_str(row.get("6_Product_Intelligence_Approx_Order_Value")),
            "size_mentioned": safe_str(row.get("6_Product_Intelligence_Size_Mentioned")),
        },
        "customer_needs": {
            "description": safe_str(row.get("7_Customer_Needs_Description")),
        },
        "barriers": {
            "store_visit": {
                "type": safe_str(row.get("8_Visit_Purchase_Barriers_Primary_StoreVisit_Barrier")),
                "detail": safe_str(row.get("8_Visit_Purchase_Barriers_StoreVisit_Barrier_Detail")),
            },
            "purchase": {
                "type": safe_str(row.get("8_Visit_Purchase_Barriers_Primary_Purchase_Barrier")),
                "detail": safe_str(row.get("8_Visit_Purchase_Barriers_Purchase_Barrier_Detail")),
            },
        },
        "conversion_hooks": {
            "store_visit": {
                "used": safe_str(row.get("10_Conversion_Hooks_Used_Store_Footfall_Driver_Used")),
                "evidence": safe_str(row.get("10_Conversion_Hooks_Used_Store_Footfall_Driver_Evidence")),
            },
            "whatsapp": {
                "used": safe_str(row.get("10_Conversion_Hooks_Used_WhatsApp_Connection_Used")),
                "evidence": safe_str(row.get("10_Conversion_Hooks_Used_WhatsApp_Connection_Evidence")),
            },
            "video_demo": {
                "used": safe_str(row.get("10_Conversion_Hooks_Used_Video_Demo_Used")),
                "evidence": safe_str(row.get("10_Conversion_Hooks_Used_Video_Demo_Evidence")),
            },
            "measurement": {
                "used": safe_str(row.get("10_Conversion_Hooks_Used_Mattress_Measurement_Used")),
                "evidence": safe_str(row.get("10_Conversion_Hooks_Used_Mattress_Measurement_Evidence")),
            },
            "offers": {
                "used": safe_str(row.get("10_Conversion_Hooks_Used_In_Store_Offers_EMI_Used")),
                "evidence": safe_str(row.get("10_Conversion_Hooks_Used_In_Store_Offers_EMI_Evidence")),
            },
            "hooks_used_count": safe_int(row.get("10_Conversion_Hooks_Used_Hooks_Used_Count")),
            "hooks_relevant_count": safe_int(row.get("10_Conversion_Hooks_Used_Hooks_Relevant_Count")),
            "missed_hook_1": safe_str(row.get("10a_hook1")),
            "missed_hook_1_reason": safe_str(row.get("10a_hook1_reason")),
            "missed_hook_2": safe_str(row.get("10a_hook2")),
            "missed_hook_2_reason": safe_str(row.get("10a_hook2_reason")),
        },
        "probing": {
            "visit_intent": {
                "asked": safe_str(row.get("11_Probing_Questions_Visit_Intent_ETA_Asked")),
                "score": score_to_label(row.get("11_Probing_Questions_Visit_Intent_ETA_Score")),
                "score_raw": safe_int(row.get("11_Probing_Questions_Visit_Intent_ETA_Score")),
                "detail": safe_str(row.get("11_Probing_Questions_Visit_Intent_ETA_Detail")),
                "reason": safe_str(row.get("11_Probing_Questions_Visit_Intent_ETA_Score_Reason")),
            },
            "why_buying": {
                "asked": safe_str(row.get("11_Probing_Questions_Why_Buying_Asked")),
                "score": score_to_label(row.get("11_Probing_Questions_Why_Buying_Score")),
                "score_raw": safe_int(row.get("11_Probing_Questions_Why_Buying_Score")),
                "detail": safe_str(row.get("11_Probing_Questions_Why_Buying_Detail")),
                "reason": safe_str(row.get("11_Probing_Questions_Why_Buying_Score_Reason")),
            },
            "whom_for": {
                "asked": safe_str(row.get("11_Probing_Questions_Whom_For_Asked")),
                "score": score_to_label(row.get("11_Probing_Questions_Whom_For_Score")),
                "score_raw": safe_int(row.get("11_Probing_Questions_Whom_For_Score")),
                "detail": safe_str(row.get("11_Probing_Questions_Whom_For_Detail")),
                "reason": safe_str(row.get("11_Probing_Questions_Whom_For_Score_Reason")),
            },
            "current_product": {
                "asked": safe_str(row.get("11_Probing_Questions_Current_Product_Asked")),
                "score": score_to_label(row.get("11_Probing_Questions_Current_Product_Score")),
                "score_raw": safe_int(row.get("11_Probing_Questions_Current_Product_Score")),
                "detail": safe_str(row.get("11_Probing_Questions_Current_Product_Detail")),
                "reason": safe_str(row.get("11_Probing_Questions_Current_Product_Score_Reason")),
            },
            "budget": {
                "asked": safe_str(row.get("11_Probing_Questions_Budget_Explored_Asked")),
                "score": score_to_label(row.get("11_Probing_Questions_Budget_Explored_Score")),
                "score_raw": safe_int(row.get("11_Probing_Questions_Budget_Explored_Score")),
                "detail": safe_str(row.get("11_Probing_Questions_Budget_Explored_Detail")),
                "reason": safe_str(row.get("11_Probing_Questions_Budget_Explored_Score_Reason")),
            },
        },
        "cross_sell": {
            "opportunity_existed": safe_str(row.get("12_Cross_Sell_Cross_Sell_Opportunity_Existed")),
            "attempted": safe_str(row.get("12_Cross_Sell_Cross_Sell_Attempted")),
            "product_mentioned": safe_str(row.get("12_Cross_Sell_Cross_Sell_Product_Mentioned")),
            "score": score_to_label(row.get("12_Cross_Sell_Cross_Sell_Score")),
            "score_raw": safe_int(row.get("12_Cross_Sell_Cross_Sell_Score")),
            "reason": safe_str(row.get("12_Cross_Sell_Cross_Sell_Reason")),
        },
        "agent_scorecard": {
            "nature": safe_str(row.get("15_Agent_Evaluation_Agent_Nature")),
            "nature_reason": safe_str(row.get("15_Agent_Evaluation_Agent_Nature_Reason")),
            "local_knowledge": score_to_label(row.get("15_Agent_Evaluation_Local_Store_Knowledge")),
            "local_knowledge_raw": safe_int(row.get("15_Agent_Evaluation_Local_Store_Knowledge")),
            "local_knowledge_reason": safe_str(row.get("15_Agent_Evaluation_Local_Store_Knowledge_Reason")),
            "product_knowledge": score_to_label(row.get("15_Agent_Evaluation_Product_Knowledge")),
            "product_knowledge_raw": safe_int(row.get("15_Agent_Evaluation_Product_Knowledge")),
            "product_knowledge_reason": safe_str(row.get("15_Agent_Evaluation_Product_Knowledge_Reason")),
            "footfall_driving": score_to_label(row.get("15_Agent_Evaluation_Footfall_Driving_Skills")),
            "footfall_driving_raw": safe_int(row.get("15_Agent_Evaluation_Footfall_Driving_Skills")),
            "footfall_driving_reason": safe_str(row.get("15_Agent_Evaluation_Footfall_Driving_Skills_Reason")),
            "need_discovery": score_to_label(row.get("15_Agent_Evaluation_Need_Discovery")),
            "need_discovery_raw": safe_int(row.get("15_Agent_Evaluation_Need_Discovery")),
            "need_discovery_reason": safe_str(row.get("15_Agent_Evaluation_Need_Discovery_Reason")),
            "objection_handling": score_to_label(row.get("15_Agent_Evaluation_Objection_Handling")),
            "objection_handling_raw": safe_int(row.get("15_Agent_Evaluation_Objection_Handling")),
            "objection_handling_reason": safe_str(row.get("15_Agent_Evaluation_Objection_Handling_Reason")),
            "explanation_quality": score_to_label(row.get("13_Explanation_Quality_Score")),
            "explanation_quality_raw": safe_int(row.get("13_Explanation_Quality_Score")),
            "explanation_quality_reason": safe_str(row.get("13_Explanation_Quality_Reason")),
            "learnings": safe_str(row.get("17_Agent_Learnings")),
        },
        "upsell": {
            "attempted": safe_str(row.get("14_Upsell_Skills_Upsell_Attempted")),
            "score": score_to_label(row.get("14_Upsell_Skills_Upsell_Score")),
            "score_raw": safe_int(row.get("14_Upsell_Skills_Upsell_Score")),
            "reason": safe_str(row.get("14_Upsell_Skills_Upsell_Reason")),
        },
        "relax_framework": {
            "reach_out": {
                "score": score_to_label(row.get("16_RELAX_Framework_R_Reach_Out_Score")),
                "score_raw": safe_int(row.get("16_RELAX_Framework_R_Reach_Out_Score")),
                "reason": safe_str(row.get("16_RELAX_Framework_R_Reach_Out_Reason")),
            },
            "explore_needs": {
                "score": score_to_label(row.get("16_RELAX_Framework_E_Explore_Needs_Score")),
                "score_raw": safe_int(row.get("16_RELAX_Framework_E_Explore_Needs_Score")),
                "reason": safe_str(row.get("16_RELAX_Framework_E_Explore_Needs_Reason")),
            },
            "link_product": {
                "score": score_to_label(row.get("16_RELAX_Framework_L_Link_Product_Score")),
                "score_raw": safe_int(row.get("16_RELAX_Framework_L_Link_Product_Score")),
                "reason": safe_str(row.get("16_RELAX_Framework_L_Link_Product_Reason")),
            },
            "add_value": {
                "score": score_to_label(row.get("16_RELAX_Framework_A_Add_Value_Score")),
                "score_raw": safe_int(row.get("16_RELAX_Framework_A_Add_Value_Score")),
                "reason": safe_str(row.get("16_RELAX_Framework_A_Add_Value_Reason")),
            },
            "express_closing": {
                "score": score_to_label(row.get("16_RELAX_Framework_X_Express_Closing_Score")),
                "score_raw": safe_int(row.get("16_RELAX_Framework_X_Express_Closing_Score")),
                "reason": safe_str(row.get("16_RELAX_Framework_X_Express_Closing_Reason")),
            },
        },
        "closing": {
            "next_actions": safe_str(row.get("18_Next_Actions")),
        },
        "airboost": {
            "agent_mentioned": safe_str(row.get("19_Airboost_Tracking_Agent_Airboost")),
            "customer_mentioned": safe_str(row.get("19_Airboost_Tracking_Customer_Airboost")),
            "upsell_possible": safe_str(row.get("19_Airboost_Tracking_Airboost_Upsell_Possible")),
            "upsell_attempted": safe_str(row.get("19_Airboost_Tracking_Airboost_Upsell_Attempted")),
            "attempt_score": safe_str(row.get("19_Airboost_Tracking_Airboost_Upsell_Attempt_Score")),
            "customer_first": safe_str(row.get("Customer Airboost First")),
        },
        "transcript": parse_transcript(row.get("Transcript_Log", "")),
    }


def _build_call_summary(row: Dict[str, str]) -> Dict[str, Any]:
    """Build a lightweight summary dict for the listing page."""
    return {
        "clean_number": safe_str(row.get("CleanNumber")),
        "brand": safe_str(row.get("Brand")),
        "store_name": safe_str(row.get("Store Name")),
        "call_date": safe_str(row.get("CallDateTime")),
        "duration": safe_int(row.get("Duration")),
        "locality": safe_str(row.get("Locality")),
        "city": safe_str(row.get("City")),
        "state": safe_str(row.get("State")),
        "call_type": safe_str(row.get("Call Type")),
        "call_objective": safe_str(row.get("1_Call_Objective_Type")),
        "intent_rating": purchase_score_to_label(row.get("5_Purchase_Readiness_Score")),
        "intent_raw": safe_int(row.get("5_Purchase_Readiness_Score")),
        "visit_rating": score_to_label(row.get("2_Intent_to_Visit_Store_Rating")),
        "experience_rating": nps_to_label(row.get("3a_Customer_Experience_Agent_NPS")),
        "experience_nps": safe_int(row.get("3a_Customer_Experience_Agent_NPS")),
        "nps_agent": safe_int(row.get("3a_Customer_Experience_Agent_NPS")),
        "nps_brand": safe_int(row.get("3b_Customer_Experience_Brand_NPS")),
        "funnel_stage": safe_str(row.get("4_Funnel_Analysis_Stage")),
        "product_category": safe_str(row.get("6_Product_Intelligence_Category")),
        "price_bucket": safe_str(row.get("MetaData_Customer_Income_Group")),
        "purchase_barrier": safe_str(row.get("8_Visit_Purchase_Barriers_Primary_Purchase_Barrier")),
        "is_converted": safe_str(row.get("is_Converted")),
        "revenue": safe_str(row.get("Revenue")),
        "call_quality": score_to_label(row.get("MetaData_Call_Quality_Overall")),
        "customer_name": safe_str(row.get("MetaData_Customer_Name")),
    }


def _build_analytics_summary(row: Dict[str, str]) -> Dict[str, Any]:
    """Build a summary dict focused on analytics dashboard requirements."""
    return {
        "clean_number": safe_str(row.get("CleanNumber")),
        "brand": safe_str(row.get("Brand")),
        "store_name": safe_str(row.get("Store Name")),
        "call_date": safe_str(row.get("CallDateTime")),
        "duration": safe_int(row.get("Duration")),
        "city": safe_str(row.get("City")),
        "call_type": safe_str(row.get("Call Type")),
        "call_objective": safe_str(row.get("1_Call_Objective_Type")),
        
        # Intent & Experience
        "intent_rating": purchase_score_to_label(row.get("5_Purchase_Readiness_Score")),
        "intent_raw": safe_int(row.get("5_Purchase_Readiness_Score")),
        "visit_rating": score_to_label(row.get("2_Intent_to_Visit_Store_Rating")),
        "visit_raw": safe_int(row.get("2_Intent_to_Visit_Store_Rating")),
        "experience_rating": nps_to_label(row.get("3a_Customer_Experience_Agent_NPS")),
        "nps_agent": safe_int(row.get("3a_Customer_Experience_Agent_NPS")),
        "nps_brand": safe_int(row.get("3b_Customer_Experience_Brand_NPS")),
        
        # Hierarchy/Categories
        "funnel_stage": safe_str(row.get("4_Funnel_Analysis_Stage")),
        "product_category": safe_str(row.get("6_Product_Intelligence_Category")),
        "price_bucket": safe_str(row.get("MetaData_Customer_Income_Group")),
        "purchase_barrier": safe_str(row.get("8_Visit_Purchase_Barriers_Primary_Purchase_Barrier")),
        
        "is_converted": safe_str(row.get("is_Converted")),
        "revenue": safe_str(row.get("Revenue")),
        
        "store_invitation": safe_str(row.get("10_Conversion_Hooks_Used_Store_Footfall_Driver_Used")),
        "wa_connection": safe_str(row.get("10_Conversion_Hooks_Used_WhatsApp_Connection_Used")),
        "video_demo": safe_str(row.get("10_Conversion_Hooks_Used_Video_Demo_Used")),
        "probing_why": safe_str(row.get("11_Probing_Questions_Why_Buying_Asked")),
        "probing_whom": safe_str(row.get("11_Probing_Questions_Whom_For_Asked")),
        "proactive": safe_str(row.get("15_Agent_Evaluation_Agent_Nature")),
        
        # RELAX Scores (Raw for averaging)
        "relax": {
            "r": safe_int(row.get("16_RELAX_Framework_R_Reach_Out_Score")),
            "e": safe_int(row.get("16_RELAX_Framework_E_Explore_Needs_Score")),
            "l": safe_int(row.get("16_RELAX_Framework_L_Link_Product_Score")),
            "a": safe_int(row.get("16_RELAX_Framework_A_Add_Value_Score")),
            "x": safe_int(row.get("16_RELAX_Framework_X_Express_Closing_Score")),
        }
    }


# ── Main data store ──────────────────────────────────────────────────────────

class CallDataStore:
    """In-memory data store for all call data."""

    def __init__(self):
        self._summaries: List[Dict[str, Any]] = []
        self._analytics: List[Dict[str, Any]] = []
        self._details: Dict[str, Dict[str, Any]] = {}  # keyed by CleanNumber
        self._raw_rows: Dict[str, Dict[str, str]] = {}  # raw CSV rows keyed by CleanNumber
        self._load()

    def _load(self):
        """Read the CSV and populate internal data structures."""
        if not CSV_PATH.exists():
            print(f"WARNING: CSV not found at {CSV_PATH}")
            return

        with open(CSV_PATH, mode="r", encoding="latin-1") as f:
            reader = csv.DictReader(f)
            for row in reader:
                clean_number = safe_str(row.get("CleanNumber"))
                if not clean_number:
                    continue

                call_type = safe_str(row.get("Call Type"))
                if call_type not in ("PRE_PURCHASE (Pre Store Visit)", "PRE_PURCHASE (Post Store Visit)"):
                    continue

                self._summaries.append(_build_call_summary(row))
                self._analytics.append(_build_analytics_summary(row))
                self._details[clean_number] = _build_call_detail(row)
                self._raw_rows[clean_number] = dict(row)  # store raw CSV row for insight extraction

        print(f"Loaded {len(self._summaries)} calls from CSV")

    def get_all_summaries(self) -> List[Dict[str, Any]]:
        return self._summaries

    def get_analytics_data(self) -> List[Dict[str, Any]]:
        return self._analytics

    def get_detail(self, clean_number: str) -> Optional[Dict[str, Any]]:
        return self._details.get(clean_number)

    def get_unique_stores(self) -> List[str]:
        return sorted(set(s["store_name"] for s in self._summaries if s["store_name"]))

    def get_unique_cities(self) -> List[str]:
        return sorted(set(s["city"] for s in self._summaries if s["city"]))

    def get_raw_rows(self, clean_numbers: List[str]) -> List[Dict[str, str]]:
        return [self._raw_rows[cn] for cn in clean_numbers if cn in self._raw_rows]

    def get_insight_columns(self, clean_numbers: List[str]) -> List[Dict[str, Any]]:
        """Return the specific columns needed for Gemini insight generation.
        
        Extracts from the stored call details, remapping to the required fields.
        """
        INSIGHT_FIELDS = [
            ("clean_number", "Clean Number"),
            ("city", "City"),
            ("store_name", "Store Name"),
            ("product_category", "Product Category"),
            ("purchase_barrier", "Purchase Barrier"),
            ("call_summary", "Call Summary"),
            ("customer_needs", "Customer Needs"),
            ("agent_nps", "Agent NPS"),
            ("agent_nps_reason", "Agent NPS Reason"),
            ("agent_good", "Agent Good"),
            ("agent_bad", "Agent Bad"),
            ("brand_nps", "Brand NPS"),
            ("brand_nps_reason", "Brand NPS Reason"),
            ("brand_good", "Brand Good"),
            ("brand_bad", "Brand Bad"),
            ("purchase_barrier_detail", "Purchase Barrier Detail"),
            ("agent_learnings", "Agent Learnings"),
            ("store_visit_barrier", "Store Visit Barrier"),
            ("store_visit_barrier_detail", "Store Visit Barrier Detail"),
        ]

        results = []
        requested = set(clean_numbers)

        for cn in clean_numbers:
            detail = self._details.get(cn)
            if not detail:
                continue

            call_type = detail.get("identity", {}).get("call_type", "")
            if call_type not in ("PRE_PURCHASE (Pre Store Visit)", "PRE_PURCHASE (Post Store Visit)"):
                continue

            row = {}
            row["Clean Number"] = cn
            row["City"] = detail.get("identity", {}).get("city", "")
            row["Store Name"] = detail.get("identity", {}).get("store_name", "")
            row["Product Category"] = detail.get("product_intelligence", {}).get("category", "")
            row["Purchase Barrier"] = detail.get("barriers", {}).get("purchase", {}).get("type", "")
            row["Call Summary"] = detail.get("summary_signals", {}).get("call_summary", "")
            row["Customer Needs"] = detail.get("customer_needs", {}).get("description", "")
            row["Agent NPS"] = detail.get("experience", {}).get("agent", {}).get("nps", 0)
            row["Agent NPS Reason"] = detail.get("experience", {}).get("agent", {}).get("reason", "")
            row["Agent Good"] = detail.get("experience", {}).get("agent", {}).get("good", "")
            row["Agent Bad"] = detail.get("experience", {}).get("agent", {}).get("bad", "")
            row["Brand NPS"] = detail.get("experience", {}).get("brand", {}).get("nps", 0)
            row["Brand NPS Reason"] = detail.get("experience", {}).get("brand", {}).get("reason", "")
            row["Brand Good"] = detail.get("experience", {}).get("brand", {}).get("good", "")
            row["Brand Bad"] = detail.get("experience", {}).get("brand", {}).get("bad", "")
            row["Purchase Barrier Detail"] = detail.get("barriers", {}).get("purchase", {}).get("detail", "")
            row["Store Visit Barrier"] = detail.get("barriers", {}).get("store_visit", {}).get("type", "")
            row["Store Visit Barrier Detail"] = detail.get("barriers", {}).get("store_visit", {}).get("detail", "")
            # Agent Learnings is in the raw CSV but not in _build_call_detail — read from raw rows
            row["Agent Learnings"] = self._raw_rows.get(cn, {}).get("17_Agent_Learnings", "")

            results.append(row)

        return results
