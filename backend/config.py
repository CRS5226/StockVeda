from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_env: str = "development"
    backend_port: int = 8000
    frontend_port: int = 5173
    db_path: str = "./data/stockveda.duckdb"
    nse_base_url: str = "https://archives.nseindia.com"
    sync_timeout_seconds: int = 30


settings = Settings()
