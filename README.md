# BatchBLAST
FastAPI-based companion for sending batch BLAST queries to NCBI, collecting CSV summaries, and generating PDF intelligence reports for every run.

## Features
- **Streamlined BLAST workflow** — asynchronously submits FASTA payloads and polls NCBI for results.
- **Automated reporting** — exports per-query CSVs plus consolidated PDF summaries and anomaly reports via ReportLab.
- **Web UI + API** — ships with Jinja templates and a websocket status channel for long-running jobs.
- **Configurable heuristics** — tune BLAST program, database, hit limits, and anomaly keywords through a simple flat file.

## Requirements
- Python 3.13+
- [uv](https://github.com/astral-sh/uv) for dependency management (or swap in `pip` if preferred)
- Optional: Perplexity API key in `.env` when using `search.py`

## Quick Start
```bash
# 1. Install dependencies
uv sync

# 2. Launch FastAPI for development (http://localhost:8000)
uv run uvicorn main:app --reload

# 3. Drop FASTA content into the UI, monitor websocket updates, and retrieve outputs from `blast_res/<run_id>/`
```
The default entry point (`main.py`) also exposes `/download` and `/preview` routes for CSV/PDF retrieval once a run completes.

## Configuration
Runtime configuration is stored in the root-level `config` file. On first launch it is auto-created with six newline-separated values:
1. **Filter** (e.g., `mL` for dusting low-complexity sequences)
2. **Hit count** (integer max for descriptions/alignments)
3. **Program** (`blastn`, `blastp`, etc.)
4. **Database** (`nt`, `nr`, ...)
5. **Non-anomaly keyword** (used to classify “normal” records)
6. **Report species label**

Update these values manually or expose a UI control that rewrites the file. `CONFIG.py` loads the list in order, so keep the ordering intact.

## Project Structure
```
blast.py        # BLAST submission & parsing pipeline
report.py       # CSV processing + PDF builders
main.py         # FastAPI app, websocket orchestration, routing
templates/      # Jinja templates for the web UI
static/         # CSS/JS/assets served by FastAPI
blast_res/      # Per-run artifacts (CSV, PDF, FASTA)
config          # Runtime settings consumed by CONFIG.load_config()
error.log       # Latest BLAST/API failure context
```

## Development & Testing
- Follow PEP 8 with 4-space indentation and snake_case names; keep async paths non-blocking by pushing heavy lifting into helper coroutines and `asyncio.create_task`.
- Seed a `tests/` package using `pytest` (recommended command: `uv run python -m pytest`). Mock HTTP responses and use zipped fixtures instead of calling the live BLAST API.
- For front-end tweaks, update Jinja templates and static assets, then rely on the `--reload` flag for live refresh.

## Troubleshooting
- Check `error.log` for NCBI or PDF generation errors; the server writes the raw response for failed jobs.
- Ensure outbound network access is permitted; repeated `Status=WAITING` responses may indicate throttling.
- Delete stale folders inside `blast_res/` if storage grows large—each run auto-generates a random ID.

## Contributing
Use imperative commit messages (e.g., `add anomaly sampler`, `fix pdf layout`), document manual tests in PR descriptions, and include screenshots or sample PDFs whenever the UI or report layout changes. See `AGENTS.md` for a deeper contributor checklist.
