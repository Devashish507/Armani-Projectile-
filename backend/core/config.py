"""
Application configuration loaded from environment variables.

Uses Pydantic Settings to provide typed, validated config with automatic
.env file loading. Import `settings` from this module wherever config is needed.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central settings object — values are read from environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

    # ── Application ──────────────────────────────────────────────
    APP_NAME: str = "Aerospace Mission Platform"
    API_VERSION: str = "v1"
    DEBUG: bool = False

    # ── CORS ─────────────────────────────────────────────────────
    # Comma-separated list of allowed origins (e.g. "http://localhost:3000")
    CORS_ORIGINS: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse the comma-separated CORS_ORIGINS string into a list."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]


# Singleton — import this everywhere
settings = Settings()
