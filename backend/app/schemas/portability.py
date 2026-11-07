from typing import Literal

from pydantic import BaseModel, ConfigDict


class ImportReport(BaseModel):
    imported: int
    # Already here: same title and start time.
    duplicates: int
    # Exercise names with no match. A workout using one is skipped whole.
    unknown_exercises: list[str]
    # Workouts that couldn't be read, by title.
    invalid: list[str]


class DeleteAccount(BaseModel):
    """A typed confirmation, so a stray request can't end an account."""

    model_config = ConfigDict(extra="forbid")

    confirm: Literal["DELETE"]
