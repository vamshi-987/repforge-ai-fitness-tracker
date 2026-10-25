from enum import StrEnum

from sqlalchemy import Enum


def str_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    """A native Postgres ENUM that stores member *values* ("muscle_gain"), not names."""
    return Enum(enum_cls, name=name, values_callable=lambda members: [m.value for m in members])
