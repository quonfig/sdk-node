# Contributing to `@quonfig/node`

Thanks for your interest in contributing! This guide covers the basics of getting set up, running
tests, and sending pull requests.

## Reporting Issues

Before opening a new issue, please check the
[issue list](https://github.com/quonfig/sdk-node/issues) to see if it has already been reported or
fixed.

When filing a bug, include:

- The version of `@quonfig/node` you're running (`npm ls @quonfig/node`)
- Node.js version (`node --version`) — we test against the active LTS line
- A minimal reproduction (a snippet, or ideally a failing test) and the actual vs. expected behavior

For security issues, please follow [SECURITY.md](./SECURITY.md) instead of filing a public issue.

## Local Development

The SDK is plain TypeScript with no monorepo tooling. Clone, install, and you're ready:

```sh
git clone https://github.com/quonfig/sdk-node.git
cd sdk-node
npm install
```

### Build

```sh
npm run build
```

`prebuild` regenerates `src/version.ts` from `package.json` so the `X-Quonfig-SDK-Version` telemetry
header always matches the published version. If you bump the version, run `npm run build` (or
`npm install`) before committing so the regenerated file is committed alongside `package.json`.

### Test

```sh
npm test          # runs vitest once
npm run test:watch
```

Some tests exercise the integration suite that lives in the sibling
[`integration-test-data`](https://github.com/quonfig/integration-test-data) repo. The CI workflow
checks out both repos side-by-side; for local runs, only the unit-level tests are required.

### Typecheck

```sh
npm run lint  # tsc --noEmit
```

## Sending Pull Requests

- Open a draft PR early if you'd like feedback before finishing the implementation.
- Add a test for any behavior change. Bug fixes should include a regression test that fails without
  the fix.
- Update `CHANGELOG.md` in the same commit as the public-API change. We follow semver — any breaking
  change must be called out in the migration notes.
- Keep commits focused. If a PR touches both a feature and an unrelated cleanup, split them.

The CI pipeline (`.github/workflows/test.yaml`) runs `npm run lint`, `npm run build`, and `npm test`
on every push and pull request — please make sure the same three commands pass locally before
requesting review.

## Releases

Releases are automated by `.github/workflows/release.yaml` — pushing a version bump on `main`
publishes to npm via OIDC. Releasing is currently maintainer-only; if your change is ready to ship,
leave a note on the PR and a maintainer will cut the release.

Thanks again for contributing!
