# Contributing to StockVeda

Thanks for your interest in StockVeda! Whether it's a typo, a bug fix or a new feature, contributions are welcome.

## Where to start

- **New here?** Pick an issue labelled [`good first issue`](https://github.com/CRS5226/StockVeda/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). Each one lists the files involved and a suggested fix.
- **More experience?** Look at [`help wanted`](https://github.com/CRS5226/StockVeda/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) or the [`enhancement`](https://github.com/CRS5226/StockVeda/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement) issues.
- **Know one part of the stack?** Filter by area: [`area: frontend`](https://github.com/CRS5226/StockVeda/issues?q=is%3Aissue+is%3Aopen+label%3A%22area%3A+frontend%22), [`area: backend`](https://github.com/CRS5226/StockVeda/issues?q=is%3Aissue+is%3Aopen+label%3A%22area%3A+backend%22), [`area: data-sync`](https://github.com/CRS5226/StockVeda/issues?q=is%3Aissue+is%3Aopen+label%3A%22area%3A+data-sync%22), [`area: ml`](https://github.com/CRS5226/StockVeda/issues?q=is%3Aissue+is%3Aopen+label%3A%22area%3A+ml%22) or [`area: tooling`](https://github.com/CRS5226/StockVeda/issues?q=is%3Aissue+is%3Aopen+label%3A%22area%3A+tooling%22).
- **Found a bug?** [Open an issue](https://github.com/CRS5226/StockVeda/issues/new/choose) with the bug report form.
- **Found a security problem?** Don't open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Have a question or an idea?** Ask in [Discussions](https://github.com/CRS5226/StockVeda/discussions).

Before working on an issue, **comment on it** so others know it's taken. For anything bigger than a small fix, describe your plan in the issue first. That saves you from building something that won't be merged.

## Setting up

Follow [Local Setup](README.md#local-setup) in the README. In short:

```bash
git clone https://github.com/<your-username>/StockVeda.git
cd StockVeda
uv sync                                              # backend
uv run uvicorn backend.main:app --port 8007 --reload
cd frontend && npm install && npm run dev            # frontend, in a second terminal
```

The database starts empty. See [Initial Data Sync](README.md#initial-data-sync) to load some data.

## Making a change

1. **Fork** the repo and create a branch from `master`:
   ```bash
   git checkout -b fix/short-description      # or feature/..., docs/...
   ```
2. **Keep it focused:** one issue per pull request.
3. **Match the surrounding code:** naming, comment style and structure. Reuse existing helpers instead of adding new ones that do the same thing (for example, `backend/data_sync/base.py` for syncs).
4. **Add tests** for backend logic in `backend/tests/`. Tests must not call external websites: mock the HTTP client, as `backend/tests/test_sync_indices.py` does.
5. **Don't commit** `.env`, the DuckDB file (`data/`), `node_modules/` or build output.

### Before you push

```bash
# Backend tests
uv run --with pytest pytest backend/tests -q

# Lint (only reports; fix what's in the files you touched)
uv run --with ruff ruff check backend

# Frontend type check + build
cd frontend && npm run build
```

### Commit messages

Short, in the imperative mood, on one line:

```
Fix win rate counting only target exits
Add NSDL FPI flows sync
```

## Opening a pull request

- Push your branch and open a PR against `master`. The template will ask for a short summary, the issue it closes, and how you tested it.
- Write `Closes #<issue number>` in the description so the issue closes when the PR is merged.
- Add screenshots for UI changes.
- A maintainer will review it. Please respond to review comments by pushing more commits to the same branch.

## Working with market data

StockVeda pulls data from free public sources (NSE, NSDL, yfinance, FRED, RBI). Please be polite to them:

- Don't add loops that hammer an endpoint. Keep requests sequential and incremental (fetch only what's missing, as the existing sync bookmarks do).
- If a source stops working, open an issue with the URL and the error before rewriting the sync.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be respectful and constructive.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
