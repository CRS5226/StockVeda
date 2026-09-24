# Security Policy

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub instead:

1. Go to the [Security tab](https://github.com/CRS5226/StockVeda/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the problem, the affected file or endpoint, and the steps to reproduce it.

Only the maintainers can see the report. You'll get a reply within a few days, and once a fix is merged we'll credit you in the advisory unless you'd rather stay anonymous.

## What counts

Examples of things worth reporting:

- Injection (SQL, command, path) through any API endpoint
- Ways to read or delete data, or trigger syncs, that a deployment wouldn't expect
- Secrets or credentials committed to the repository
- Vulnerable dependencies that are actually reachable from StockVeda's code

## Supported versions

StockVeda is self-hosted and developed on `master`. Security fixes go to `master` and the latest release; please update to them.

## Deploying safely

StockVeda is built to run on your own machine. If you expose it to the internet:

- Set `CORS_ORIGINS` in `.env` to your own domain only.
- Put it behind a reverse proxy with authentication (for example nginx basic auth), because the API has no login of its own and includes endpoints that delete data or start downloads.
