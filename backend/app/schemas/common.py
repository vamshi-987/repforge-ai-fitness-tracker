from typing import Any, ClassVar, Self

from pydantic import BaseModel, ConfigDict, model_validator


class PatchModel(BaseModel):
    """Base for PATCH bodies: omitted fields are left unchanged.

    Every field is optional so it can be omitted, but an explicit `null` is only accepted for
    fields listed in `clearable`; for the rest it is a validation error, not "set to NULL".
    """

    model_config = ConfigDict(extra="forbid")

    clearable: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="after")
    def _reject_null_for_required_fields(self) -> Self:
        for name in self.model_fields_set:
            if getattr(self, name) is None and name not in self.clearable:
                raise ValueError(f"{name} cannot be null")
        return self

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)
