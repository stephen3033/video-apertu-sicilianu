from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VAS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./data/app.db"
    session_secret: str = "development-only-change-me"
    cookie_secure: bool = False
    storage_backend: str = "local"
    storage_root: Path = Path("./data/uploads")
    max_upload_bytes: int = Field(default=1024 * 1024 * 1024, gt=0)
    allowed_media_extensions: str = (
        ".mp4,.m4v,.mov,.webm,.mkv,.avi,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus"
    )
    email_backend: Literal["console", "smtp"] = "console"
    email_sender_address: str | None = None
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, gt=0, le=65535)
    smtp_starttls: bool = True
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_timeout_seconds: int = Field(default=10, gt=0)
    auth_code_secret: str = "development-only-auth-code-secret"
    auth_code_lifetime_seconds: int = Field(default=10 * 60, gt=0)
    auth_code_max_attempts: int = Field(default=5, gt=0)
    auth_code_resend_cooldown_seconds: int = Field(default=60, ge=0)
    auth_code_email_limit: int = Field(default=3, gt=0)
    auth_code_email_window_seconds: int = Field(default=15 * 60, gt=0)
    auth_code_ip_limit: int = Field(default=20, gt=0)
    auth_code_ip_window_seconds: int = Field(default=60 * 60, gt=0)
    auth_challenge_retention_seconds: int = Field(default=24 * 60 * 60, gt=0)
    authenticated_session_lifetime_seconds: int = Field(default=12 * 60 * 60, gt=0)

    @model_validator(mode="after")
    def validate_email_settings(self) -> Settings:
        if self.email_backend != "smtp":
            return self
        missing = [
            name
            for name, value in (
                ("smtp_host", self.smtp_host),
                ("email_sender_address", self.email_sender_address),
            )
            if not value
        ]
        if missing:
            raise ValueError(
                "SMTP email backend requires: " + ", ".join(missing)
            )
        if bool(self.smtp_username) != bool(self.smtp_password):
            raise ValueError(
                "SMTP username and password must either both be set or both be omitted"
            )
        return self

    @property
    def extension_set(self) -> frozenset[str]:
        return frozenset(
            extension.strip().lower()
            for extension in self.allowed_media_extensions.split(",")
            if extension.strip()
        )

    @property
    def upload_limit_label(self) -> str:
        gibibytes = self.max_upload_bytes / (1024**3)
        if gibibytes >= 1:
            return f"{gibibytes:g} GB"
        mebibytes = self.max_upload_bytes / (1024**2)
        return f"{mebibytes:g} MB"


@lru_cache
def get_settings() -> Settings:
    return Settings()
