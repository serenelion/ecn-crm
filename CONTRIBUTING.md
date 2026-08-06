# Contributing to ECN CRM

ECN CRM (`ecn-crm`) is an Earth Care Network fork of [Twenty CRM](https://github.com/twentyhq/twenty)
(tracked at tag/commit `twenty/v2.27.0`, see [`NOTICE.ECN`](./NOTICE.ECN)). It is the **Community
Edition (CE) core** of the ECN Growth OS: AGPL-licensed, free to self-host and contribute to.

> Trademark note: the public / white-label marketing name waits on trademark counsel. In ECN
> test environments the product displays as **CRM**. Do not introduce upstream "Twenty" branding
> into customer-facing chrome (nav, headers, emails, launchers) — see `WHITE_LABEL.md`.

## License planes (read before you change anything)

This repo has **three** license planes. They are preserved exactly as set in the
[`LICENSE`](./LICENSE) file — do not "fix" them.

| Plane | Covers | Terms |
|-------|--------|-------|
| **AGPL-3.0** (core) | Most of the repo — backend, frontend app, integrations | GNU Affero GPL v3.0, **plus** the Twenty Application Exception (§7 additional permission) |
| **MIT** | `twenty-ui`, `twenty-shared`, `twenty-sdk`, `twenty-client-sdk`, `create-twenty-app`, `packages/twenty-apps` | Per each package's own `LICENSE` / `package.json` |
| **Upstream commercial (`/* @license Enterprise */`)** | A small set of upstream files, unchanged from upstream | Twenty.com Commercial License — **not** ECN's to relicense, modify for production use, or redistribute without a valid Twenty Enterprise Edition subscription |

Contributions to AGPL-3.0 files are themselves AGPL-3.0 (share-alike). Do **not** add new
`/* @license Enterprise */` files and do **not** modify the ones upstream shipped.

## Dev workflow

This is an Nx + Yarn 4 monorepo. See [`CLAUDE.md`](./CLAUDE.md) for the full command reference.
The short version:

```bash
corepack enable            # ensure Yarn 4
yarn install

# Run a single test file (fast, preferred)
cd packages/twenty-server && npx jest "path/to/test.test.ts"
npx nx test twenty-front

# Quality gates before opening a PR
npx nx lint:diff-with-main twenty-front
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-front
npx nx typecheck twenty-server
```

Rules enforced in CI / review:

- **Functional components only, named exports only, no `any`, string-literal unions over enums**
  (except GraphQL enums), `camelCase` vars, `SCREAMING_SNAKE_CASE` constants, `kebab-case` files.
- **Entity changes** require a generated instance command
  (`npx nx run twenty-server:database:migrate:generate --name <name> --type fast|slow`).
- **GraphQL schema changes** require `npx nx run twenty-front:graphql:generate` afterward.
- Never delete or rewrite committed instance-command `up`/`down` logic.

## PR rules

1. Branch off `main` (or your team's feature branch). Keep PRs scoped.
2. **No secrets.** Never commit credentials, `.env` real values, or signing keys. Run
   `gitleaks` / `trufflehog` locally before pushing.
3. **Preserve notices.** Do not strip `NOTICE.ECN`, upstream copyright headers, or the
   `LICENSE` file. Attribution lives in Source/About + `NOTICE.ECN` (AGPL §5(a)/§7(b)).
4. **Brand stays neutral in code.** Customer-facing brand is supplied at runtime via
   `ECN_BRAND_*` env (V40-4 brand-scrub). Don't hardcode product names in source.
5. **Tests green** on the package you touched (run the full package suite, not a lone file,
   when in doubt).
6. Commits use the repo's required trailers (`Signed-off-by` + `Co-authored-by`) per the
   owning operator's git config.

## Source availability (AGPL §13)

When this modified software is offered as a network service in production, Corresponding Source
must be published per AGPL §13. Until counsel green-lights the public flip, this repository may
remain private, but the in-UI **Source** link surface must be wired (footer / About) so the
§13 offer is visible before production GO. See `NOTICE.ECN` for the publication-path note.

## Questions

- **CE core / AGPL / contribution mechanics:** open an issue or PR in this repo.
- **Commercial white-label / resale licensing:** see [`WHITE_LABEL.md`](./WHITE_LABEL.md).
