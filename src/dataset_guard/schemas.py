from typing import Literal

from pydantic import BaseModel, Field


class GuardActionRequest(BaseModel):
    action: Literal["protect", "unprotect", "soft_delete", "hard_delete"]
    confirmation_text: str = Field(min_length=1, max_length=255)

