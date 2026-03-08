from __future__ import annotations

from importlib import import_module
from typing import Any

__all__ = ["AnalysisAgent", "IngestionAgent", "InsightWriterAgent", "MarketAgent"]

_EXPORTS = {
    "AnalysisAgent": ("agents.analysis", "AnalysisAgent"),
    "IngestionAgent": ("agents.ingestion", "IngestionAgent"),
    "InsightWriterAgent": ("agents.insight_writer", "InsightWriterAgent"),
    "MarketAgent": ("agents.market_agent", "MarketAgent"),
}


def __getattr__(name: str) -> Any:
    """Load heavyweight agent modules only when their symbol is requested."""
    try:
        module_name, attr_name = _EXPORTS[name]
    except KeyError as exc:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from exc

    module = import_module(module_name)
    value = getattr(module, attr_name)
    globals()[name] = value
    return value
