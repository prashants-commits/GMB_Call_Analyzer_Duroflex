"""Store SWOT (Group B).

Pipeline: latest_calls_for_store -> Stage-1 Map (Flash, parallel batches) ->
Stage-2 Reduce (Pro, synthesise) -> SWOTReport -> cache.
"""

from .schema import SWOTItem, SWOTReport
from .input_adapter import latest_calls_for_store
from .stage1_map import run_stage1, Stage1Error
from .stage2_reduce import run_stage2, Stage2Error
from .cache import get_cached, put_cache, list_cached
from .orchestrator import generate_swot, SWOTGenerationError

__all__ = [
    "SWOTItem",
    "SWOTReport",
    "latest_calls_for_store",
    "run_stage1",
    "Stage1Error",
    "run_stage2",
    "Stage2Error",
    "get_cached",
    "put_cache",
    "list_cached",
    "generate_swot",
    "SWOTGenerationError",
]
