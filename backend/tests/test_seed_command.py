import pytest

from app.commands import seed
from app.services.library_seed import SeedCounts, SeedError, SeedReport


def test_main_prints_the_report(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def fake_main() -> SeedReport:
        return SeedReport(SeedCounts(inserted=20), SeedCounts(inserted=14), SeedCounts(inserted=3))

    monkeypatch.setattr(seed, "_main", fake_main)

    assert seed.main() == 0
    assert "exercises: 3 new, 0 updated, 0 unchanged" in capsys.readouterr().out


def test_main_exits_non_zero_when_the_seed_is_refused(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def refused() -> SeedReport:
        raise SeedError("exercise type is immutable: nope")

    monkeypatch.setattr(seed, "_main", refused)

    assert seed.main() == 1
    assert "seed refused: exercise type is immutable" in capsys.readouterr().err
