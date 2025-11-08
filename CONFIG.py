from pathlib import Path
from typing import Dict, Iterable, List, Tuple, Union

BASE_URL = "https://blast.ncbi.nlm.nih.gov/Blast.cgi"
CONFIG_PATH = Path("config")
_CONFIG_KEYS = ["filter", "output_qty", "program", "database", "non_anomaly", "species_name"]
_DEFAULT_CONFIG = {
    "filter": "mL",
    "output_qty": "1000",
    "program": "blastn",
    "database": "nt",
    "non_anomaly": "sus scrofa",
    "species_name": "Sample",
}


def _ensure_config_file() -> None:
    """Ensure the config file exists with sane defaults."""
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text("\n".join(_DEFAULT_CONFIG[key] for key in _CONFIG_KEYS))


def _normalize_values(
    values: Union[Dict[str, Union[str, int]], Iterable[Union[str, int]]]
) -> List[str]:
    """Normalize input values into the canonical order."""
    normalized = {**_DEFAULT_CONFIG}

    if isinstance(values, dict):
        for key in _CONFIG_KEYS:
            if key in values and values[key] not in (None, ""):
                normalized[key] = str(values[key]).strip()
    else:
        ordered_values = list(values)
        for idx, key in enumerate(_CONFIG_KEYS):
            if idx < len(ordered_values) and ordered_values[idx] not in (None, ""):
                normalized[key] = str(ordered_values[idx]).strip()

    # Force output quantity to remain numeric text
    qty = normalized["output_qty"]
    normalized["output_qty"] = str(qty).strip() if str(qty).strip() else _DEFAULT_CONFIG["output_qty"]
    return [normalized[key] for key in _CONFIG_KEYS]


def load_config() -> Tuple[str, str, str, str, str, str]:
    """Return the raw config tuple used throughout the app."""
    _ensure_config_file()
    lines = CONFIG_PATH.read_text().splitlines()
    normalized = _normalize_values(lines)
    return tuple(normalized)  # type: ignore[return-value]


def load_config_dict() -> Dict[str, str]:
    """Return the config as a dictionary for API responses."""
    values = load_config()
    return {key: values[idx] for idx, key in enumerate(_CONFIG_KEYS)}


def save_config(values: Union[Dict[str, Union[str, int]], Iterable[Union[str, int]]]) -> Tuple[str, str, str, str, str, str]:
    """Persist config values to disk, returning the normalized tuple."""
    normalized = _normalize_values(values)
    CONFIG_PATH.write_text("\n".join(normalized))
    return tuple(normalized)  # type: ignore[return-value]


CONFIG = {
    "normal_sample_size": 5
}
