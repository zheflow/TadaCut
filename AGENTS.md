# TadaCut development

The code in this project is independently implemented; do not copy code or private implementation from other products.

- `packages/domain` is deterministic and independent of React, Electron, network, storage, and model providers.
- All persistent edits use validated commands and a checked project revision. Composite story/timeline edits share one transaction and one undo entry.
- API keys stay in the host vault. Public provider DTOs contain only `hasKey`, never plaintext keys.
- Desktop operations are scoped to an explicitly started automation session and typed actions. Never expose a generic shell bridge.
- Features needing a provider, model download, native permission, or external CLI must report their actual availability.
- Run type checking, meaningful domain/API tests, and production builds. Verify UI flows on the actual local app. Do not render a movie or call paid models as part of routine verification.
