import os
from typing import Tuple

BASE_URL = "https://blast.ncbi.nlm.nih.gov/Blast.cgi"
CONFIG_FILE = "config"
DEFAULT_CONFIG = ("mL", "1000", "blastn", "nt", "bos taurus", "sus scrofa")


def save_config(
    filter_value: str,
    output_qty: str,
    program: str,
    database: str,
    non_anomaly_keyword: str,
    species_name: str,
) -> Tuple[str, str, str, str, str, str]:
    """Persist the ordered config values to disk."""
    values = [
        str(filter_value or ""),
        str(output_qty or ""),
        str(program or ""),
        str(database or ""),
        str(non_anomaly_keyword or ""),
        str(species_name or ""),
    ]
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(values))
    return tuple(values)  # type: ignore[return-value]


def load_config() -> Tuple[str, str, str, str, str, str]:
    if not os.path.exists(CONFIG_FILE):
        return save_config(*DEFAULT_CONFIG)

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        configs = [line.rstrip("\n") for line in f.readlines()]

    if len(configs) < len(DEFAULT_CONFIG):
        configs += list(DEFAULT_CONFIG[len(configs):])
        save_config(*configs[: len(DEFAULT_CONFIG)])

    return tuple(configs[: len(DEFAULT_CONFIG)])  # type: ignore[return-value]



CONFIG = {
    'normal_sample_size': 5
}
