# WYD!! (watchadoin)

Cal Hacks 13.0. Devpost deadline **Sun Oct 25 2026, 9:00 AM PST**. A working, reliable demo beats extra features.
Opt-in group focus app: sustained drift → rare, short surprise group check-in call. Social, never shaming.

## Read first
| Task | Read |
|---|---|
| Any task | `docs/status.md` (what's built, broken, next) |
| Product behavior | `docs/product/spec.md`, `vision.md` |
| Shared data: events, enums, IPC | `docs/architecture/contracts.md` |
| System layout, data flow | `docs/architecture/overview.md` |
| Versions, env vars, commands | `docs/architecture/stack.md` |
| SpacetimeDB module | `docs/components/spacetimedb.md` → `spacetimedb-schema.md`; SDK rules: `docs/reference/spacetimedb-sdk.md` |
| Other components | `docs/components/<name>.md` if it exists, else `docs/status.md` |
| Unsettled questions | `docs/product/decisions.md` |

## Hard rules
- **Privacy:** webcam frames/video never leave the laptop. Only small text events go to SpacetimeDB. Replay clips are local, deleted at session end. No consent screen (hackathon scope). Details: `docs/product/privacy.md`.
- **AI calls:** rules + cache first; only unknown/ambiguous titles go to a model. Judgment input is text only. Calls run in the background, never block UI. One Claude call per session for summary + replay captions.
- **Contract:** don't change `contracts.md` items (event fields, enums) without telling the team.
- **Open decisions** (`decisions.md`): ask, don't assume.
- Never commit API keys; use `.env` (gitignored).
- Ask before adding dependencies or services. Simple and working > clever.
- One branch per person/feature, small PRs into `main`.

## Keeping docs current
Update docs in the same change, every time, on:
| Trigger | Update |
|---|---|
| Feature built, stubbed, or removed | `docs/status.md` (Built/Stubbed/Missing) + `docs/components/<name>.md` if it exists |
| Event field, enum, IPC channel, or reducer signature changed | `docs/architecture/contracts.md`, and tell the team |
| Dependency, model, env var, or command added/changed | `docs/architecture/stack.md` |
| Data flow or component wiring changed | `docs/architecture/overview.md` |
| Bug, blocker, or setup issue that can affect others | `docs/status.md` Gotchas (or Mismatches if two parts disagree) |
| Open question answered | `docs/product/decisions.md` |

Follow "Writing docs" below. If unsure whether a change is major, update `status.md`.

## Writing docs (applies to every doc create/edit)
Docs are read mainly by AI. Max info, min tokens.
- One fact, one place. Link instead of repeating (e.g. "see contracts.md#status").
- Prefer tables, lists, `key: value`, and code identifiers over prose.
- No filler: no intros, recaps, "this section describes", or marketing tone.
- Use exact names, numbers, and paths (`worker/judge.ts`, `60 s`, `claude-haiku-5-5`), never vague references.
- State current facts only. History belongs in git; open questions belong in `decisions.md`.
- Don't document what the code makes obvious; document intent, contracts, and gotchas.
- When editing, cut or merge stale and duplicate text rather than only appending.

## Commands
- "reorganize" / "update the docs" → follow the Reorganize procedure in `docs/status.md`.
