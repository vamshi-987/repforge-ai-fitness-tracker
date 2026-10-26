"""How a search box query becomes something to match exercise names against.

The mobile app runs the same normalization over its offline copy of the library
(`mobile/src/exercises/search.ts`); keep the two alias tables identical.
"""

import re
from dataclasses import dataclass

MAX_QUERY_LENGTH = 80

# Shorthand lifters type, expanded before matching ("db bench" finds dumbbell bench presses).
ALIASES: dict[str, str] = {
    "bb": "barbell",
    "db": "dumbbell",
    "kb": "kettlebell",
    "ez": "ez bar",
    "rdl": "romanian deadlift",
    "sldl": "stiff-leg deadlift",
    "ohp": "overhead press",
    "pushup": "push-up",
    "pushups": "push-up",
    "pullup": "pull-up",
    "pullups": "pull-up",
    "chinup": "chin-up",
    "chinups": "chin-up",
    "situp": "sit-up",
    "situps": "sit-up",
}

_SEPARATORS = re.compile(r"[\s,;/]+")


@dataclass(frozen=True)
class SearchQuery:
    # Lowercased, aliases expanded, single spaces: what fuzzy similarity compares.
    text: str
    # Every token must appear somewhere in the name for a "contains" match.
    tokens: tuple[str, ...]


def normalize_query(raw: str) -> SearchQuery | None:
    """None when the query has nothing to search for (blank or only separators)."""
    words = [w for w in _SEPARATORS.split(raw.strip().lower()[:MAX_QUERY_LENGTH]) if w]
    expanded = " ".join(ALIASES.get(word, word) for word in words)
    tokens = tuple(dict.fromkeys(expanded.split()))
    if not tokens:
        return None
    return SearchQuery(text=" ".join(expanded.split()), tokens=tokens)


def escape_like(value: str) -> str:
    """Escape LIKE wildcards so a typed `%` or `_` matches literally (escape char: backslash)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
