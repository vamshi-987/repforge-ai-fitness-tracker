from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class PushTokenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expo_token: Annotated[str, Field(max_length=200, pattern=r"^Expo(nent)?PushToken\[[^\]]+\]$")]
    platform: Literal["ios", "android"]
