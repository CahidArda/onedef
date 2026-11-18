# Changesets

Run `pnpm changeset` in a PR that changes a published package, pick the bump,
and describe the change for users. On merge to main, the Release workflow opens
(or updates) a "Version packages" PR; merging that one publishes to npm.

All packages share one version (`fixed` in config.json): a change to any of
them releases all of them, so `onedef` and `@onedef/*` always match.
