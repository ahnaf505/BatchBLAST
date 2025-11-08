# Repository Guidelines

## Very important notes
do not use python or python3 or pip, or any other python tools use uv because thats the only one we can use, the python in my host system is a bit corrupt if need to run pip or anything else please use uv run pip instead of running it directly

## Project Structure & Module Organization
BatchBLAST is a FastAPI service (`main.py`) that orchestrates asynchronous BLAST submissions (`blast.py`) and report generation (`report.py`). Templates power the web UI (`templates/`), static assets sit in `static/`, and run artifacts land in `blast_res/<run_id>/` (CSV, FASTA, PDF). Runtime options live in the `config` file and are surfaced through `CONFIG.py`; treat `error.log` as disposable diagnostics, this project uses uv the python package and environment manager just so you know.

## Build, Test, and Development Commands
- `uv sync` — install the Python environment defined in `pyproject.toml`/`uv.lock`.
- `uv run uvicorn main:app --reload` — start the FastAPI server with live reload for UI work.
- `uv run python main.py` — alternate entry point that invokes the same uvicorn setup without hot reload.
- `uv run python -m pytest` — placeholder once automated tests reside in `tests/`.

## Coding Style & Naming Conventions
Follow PEP 8 with four-space indentation and descriptive snake_case for modules, functions, and variables (`run_blast_job`, `generate_report`). Keep async I/O pathways non-blocking; long-running filesystem work belongs in helpers executed via `asyncio.create_task`. Prefer type hints for public functions and short docstrings describing side effects. Templates and static assets should remain in lower-case-hyphen file names.

## Testing Guidelines
There is no formal suite yet, so introduce `tests/` with `test_<module>.py` files that isolate async flows (use `pytest.mark.asyncio`). Stub BLAST responses by storing zipped fixtures under `tests/data/` instead of calling NCBI, and validate report generation by asserting on CSV/PDF metadata rather than binary equality. Cover parsing edge cases (missing `hsps`, malformed titles) plus configuration fallbacks.
,
## Commit & Pull Request Guidelines
History currently shows only the initial bootstrap commit, so adopt an imperative style (e.g., `add anomaly sampler`, `fix pdf layout`) and keep summaries under 60 characters. Pull requests should link issues, describe testing performed (commands + datasets), and include screenshots or generated reports when UI or PDF output changes. Call out schema or config updates so reviewers can refresh deployment secrets.

## Branching & Workflow Expectations
Open a dedicated feature branch for every significant change (anything beyond a trivial typo), and ship the work via a pull request instead of pushing directly to `main`. Each milestone-sized update should have its own branch/PR so reviewers can track progress, and multiple milestones can stack as long as their PRs are chained in order. Document meaningful successes or blockers in `success.txt` / `problem.txt` while working.

## Configuration & Security Notes
Never hard-code API keys; load them through `.env` as consumed by `search.py`/Perplexity. The plaintext `config` file is read at runtime—document any new fields and supply safe defaults in `CONFIG.py`. Treat `blast_res/` as temporary output; avoid committing real BLAST data or sensitive sequences.
