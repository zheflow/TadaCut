# Contributing to TadaCut

Bug reports, documentation improvements, and focused pull requests are welcome. For bugs, include the operating system, Node version, reproduction steps, and observed result. Remove credentials, private media, local paths, and personal data before sharing logs or screenshots.

Use Node 22.22.0 or a newer Node 22 LTS release and npm 10. Install with `npm ci`, then start with `npm run dev`.

Before submitting, run `npm run check`, relevant tests, and `npm run build`. Use `npm run format:check` for formatting, `npm run test:ui` for browser flows, and `npm run test:shaders` for rendering changes. Desktop flows are covered by `scripts/smoke-assistant-ui.mjs` and `scripts/smoke-features-ui.mjs`.

Keep domain commands deterministic, validate persistent changes, and preserve revision checks and undo behavior. Credentials belong in the host vault; public responses must not expose plaintext keys. External capabilities must report missing configuration and failures honestly.

Contribute code you have the right to license. Preserve required attribution and document new dependency licenses. Generated builds, personal data, credentials, and local test evidence must stay out of commits.

Contributions are provided under the repository's MIT License unless a file explicitly states otherwise.
