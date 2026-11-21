# Contributing

栖页 is a local-first reading workspace. Contributions are welcome when they
keep the project honest about what it can and cannot do.

## Before you start

- Read the README and `docs/ARCHITECTURE.md`.
- For a substantial change, open an issue first describing the user problem,
  the intended behavior and the smallest useful scope.
- Do not include real research papers, private notes, credentials, personal
  identifiers or generated test artifacts in an issue, commit or pull request.
- Do not present synthetic data, test fixtures or placeholder translations as
  research findings.

## Development

```sh
npm ci
npm run dev
npm run build
npm test
```

The project uses a Node 24 launcher through `scripts/with-node.mjs`. Keep the
existing package manager and lockfile. If a change affects PDF parsing,
translation, storage or export, add a focused regression test.

## Pull requests

- Keep the change focused and explain the user-visible outcome.
- Include the commands you ran and any browser or device conditions.
- Separate source changes from generated output. Do not commit `dist/`,
  `node_modules/`, model weights or local test artifacts.
- Preserve source page references, human-edited translations and existing
  backup behavior.
- For export changes, check that missing source files, missing images,
  cancellation and size limits fail explicitly instead of producing a partial
  file.
- For UI changes, check at least one desktop viewport and one narrow viewport.
  Respect reduced motion and keyboard focus.

## Commit style

Use a short imperative subject, for example:

```text
fix: reject invalid page ranges in export
docs: explain source-page appendices
```

## Reporting problems

Use the GitHub Issues page for reproducible bugs and scoped feature requests.
Do not paste a full paper, private notes, account identifiers, tokens or
screenshots containing personal information. For a security-sensitive report,
avoid a public issue with exploit details and contact the maintainer through
the repository's private security channel if one is available.

## License

By contributing, you agree that your original contribution can be distributed
under the repository's MIT license. Third-party assets keep their own licenses.
