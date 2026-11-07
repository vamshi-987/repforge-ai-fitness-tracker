"""What the LLM cost, from the `ai_call` log lines:

docker compose logs --no-log-prefix api worker | python -m app.commands.ai_costs
"""

import json
import sys
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

# US dollars per million tokens. Check against current pricing before relying on a report.
PRICES: dict[str, tuple[float, float]] = {"claude-sonnet-5-5": (2.0, 10.0)}
PER_MILLION = 1_000_000


@dataclass
class Usage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    cost_usd: float = 0.0

    @property
    def average_latency_ms(self) -> int:
        return round(self.latency_ms / self.calls) if self.calls else 0


def call_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """0 for a model with no price listed, so a report never crashes on a new one."""
    input_price, output_price = PRICES.get(model, (0.0, 0.0))
    return (input_tokens * input_price + output_tokens * output_price) / PER_MILLION


def summarize(lines: Iterable[str]) -> dict[tuple[str, str], Usage]:
    """(day, feature) → usage. Lines that aren't `ai_call` JSON are skipped."""
    totals: dict[tuple[str, str], Usage] = defaultdict(Usage)
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if not isinstance(record, dict) or record.get("message") != "ai_call":
            continue
        usage = totals[(str(record.get("ts", ""))[:10], str(record.get("feature")))]
        tokens_in = int(record.get("input_tokens", 0))
        tokens_out = int(record.get("output_tokens", 0))
        usage.calls += 1
        usage.input_tokens += tokens_in
        usage.output_tokens += tokens_out
        usage.latency_ms += int(record.get("latency_ms", 0))
        usage.cost_usd += call_cost(str(record.get("model")), tokens_in, tokens_out)
    return dict(totals)


def render(totals: dict[tuple[str, str], Usage]) -> str:
    rows = ["day         feature            calls   input  output  avg ms   cost $"]
    for (day, feature), usage in sorted(totals.items()):
        rows.append(
            f"{day:<11} {feature:<18} {usage.calls:>5} {usage.input_tokens:>7} "
            f"{usage.output_tokens:>7} {usage.average_latency_ms:>7} {usage.cost_usd:>8.4f}"
        )
    total = sum(u.cost_usd for u in totals.values())
    rows.append(f"total {total:.4f} USD")
    return "\n".join(rows)


def main() -> None:
    print(render(summarize(sys.stdin)))


if __name__ == "__main__":
    main()
