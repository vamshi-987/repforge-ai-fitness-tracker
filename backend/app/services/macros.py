"""Food log arithmetic, the single source of truth for logged nutrition (CLAUDE.md §10).

A log keeps the food's per-100 g values as a snapshot. Its amounts are that snapshot scaled to
the grams eaten, unless the user edited them:
- macros edited (protein, carbs, fat, fiber): calories follow as 4P + 4C + 9F;
- calories set explicitly: kept as typed, and flagged "manual".
"""

from dataclasses import dataclass

from app.services.profile import round_half_up

KCAL_PER_G_PROTEIN = 4
KCAL_PER_G_CARBS = 4
KCAL_PER_G_FAT = 9


@dataclass(frozen=True)
class Per100g:
    kcal: float
    protein: float
    carbs: float
    fat: float
    fiber: float | None = None


@dataclass(frozen=True)
class MacroOverride:
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float | None = None


@dataclass(frozen=True)
class Amounts:
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float | None
    macros_overridden: bool
    kcal_overridden: bool


def kcal_from_macros(protein_g: float, carbs_g: float, fat_g: float) -> float:
    return KCAL_PER_G_PROTEIN * protein_g + KCAL_PER_G_CARBS * carbs_g + KCAL_PER_G_FAT * fat_g


def scale(per_100g: float, grams: float) -> float:
    return per_100g * grams / 100


def log_amounts(
    per_100g: Per100g,
    grams: float,
    macros: MacroOverride | None = None,
    kcal: float | None = None,
) -> Amounts:
    """What a log of `grams` holds. Amounts are rounded to 0.1 (kcal and grams)."""
    if macros is None:
        protein = scale(per_100g.protein, grams)
        carbs = scale(per_100g.carbs, grams)
        fat = scale(per_100g.fat, grams)
        fiber = None if per_100g.fiber is None else scale(per_100g.fiber, grams)
        energy = scale(per_100g.kcal, grams)
    else:
        protein, carbs, fat, fiber = macros.protein_g, macros.carbs_g, macros.fat_g, macros.fiber_g
        energy = kcal_from_macros(protein, carbs, fat)
    if kcal is not None:
        energy = kcal
    return Amounts(
        kcal=round_half_up(energy, 1),
        protein_g=round_half_up(protein, 1),
        carbs_g=round_half_up(carbs, 1),
        fat_g=round_half_up(fat, 1),
        fiber_g=None if fiber is None else round_half_up(fiber, 1),
        macros_overridden=macros is not None,
        kcal_overridden=kcal is not None,
    )
