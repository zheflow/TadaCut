# TadaCut development

The code in this project is independently implemented; do not copy code or private implementation from other products.

- `packages/domain` is deterministic and independent of React, Electron, network, storage, and model providers.
- All persistent edits use validated commands and a checked project revision. Composite story/timeline edits share one transaction and one undo entry.
- API keys stay in the host vault. Public provider DTOs contain only `hasKey`, never plaintext keys.
- Desktop operations are scoped to an explicitly started automation session and typed actions. Never expose a generic shell bridge.
- Features needing a provider, model download, native permission, or external CLI must report their actual availability.
- Run type checking, meaningful domain/API tests, and production builds. Verify UI flows on the actual local app. Do not render a movie or call paid models as part of routine verification.

## Agent baseline

- Preserve the baseline in `docs/agent-foundation.md`: skill discovery and loading, bounded tool discovery, context budgets and compaction, task plans, working state, project and long-term memory, resumable execution, permissions and observable results.
- Never inject the complete tool catalog into a model or external runtime. Load workflows, reference files and concrete tool schemas as needed.
- Keep task state and loaded skill references independent of transcript summaries. Resuming must retain the original connection and mode, and unknown tool outcomes must be checked before replay.
- Memory candidates require user acceptance. Context reset must preserve project and long-term memories; concurrent runs must not overwrite a conversation.
