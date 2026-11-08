# AGENTS.md — Working Rules for AnchorCCTP SDK

This file is read by AI coding agents (Claude Code, Cursor, etc.) before doing any work in this
repo. It is the operating contract: how to structure work, what "done" means, and what is
never acceptable to ship. Compatible with Claude Code / any `AGENTS.md`-aware tool — rename or
symlink to `CLAUDE.md` if your tool expects that filename.

## 0. Project Context (read docs/PRD.md first)

Full requirements live in `docs/PRD.md`. This file only covers *how to work*, not *what to build*.
If a request conflicts with `docs/PRD.md` §4.2 (Out of Scope), stop and flag it — don't silently
implement out-of-scope work even if it seems helpful.

## 1. TDD Is Mandatory, Not Optional

For every unit of behavior in `packages/core` and `packages/cli`:

1. Write the test first. It must fail for the right reason (run it, confirm red).
2. Write the minimum implementation to make it pass.
3. Refactor only with tests green.
4. Never write implementation code with no corresponding test in the same commit/PR.

**Never delete or weaken a test to make a build pass.** If a test seems wrong, fix the test
deliberately as its own reviewable change with a stated reason — don't quietly loosen an
assertion to unblock a merge.

Before opening a PR, run locally:
```
npm run lint && npm run typecheck && npm run test -- --coverage
```
`core` coverage must stay ≥ 90% lines. If a change drops it, add tests before requesting review,
don't lower the threshold in `jest.config`.

## 2. Security Checklist (verify before every PR touching money-moving logic)

Money-moving logic = anything in `attestation/`, `decimals/`, `forwarder/`, `trustline/`.

- [ ] No private key or secret is accepted, stored, or logged by this code path.
- [ ] Any signing is delegated to a caller-supplied callback or explicit sponsor-key env var —
      never a hardcoded or committed key.
- [ ] Attestation is cryptographically verified before any credit/settlement logic runs.
- [ ] The `burnTxHash` (or equivalent) is checked against a processed-transactions store before
      crediting — replay of the same transfer must be a no-op, not a double-credit.
- [ ] Amount math uses integer/BigInt, never `number`/float, for anything involving decimals.
- [ ] Negative, zero, and overflow amounts are rejected with a typed error, not silently clamped.
- [ ] `sourceDomain` is checked against the allow-listed domain table; unknown domains are
      rejected explicitly.
- [ ] Trustline auto-creation is behind an explicit opt-in flag with a spending cap — never
      silent, never unbounded.
- [ ] No secret, key, or full transaction payload is written to logs or error messages.
- [ ] New dependencies are pinned (no `^`/`~` on crypto/Stellar SDK deps) and `npm audit` is
      clean or explicitly waived with a written reason.

If any box can't be checked, the PR is not mergeable — say so explicitly rather than shipping
with a caveat buried in the description.

## 3. Directory & Package Conventions

Follow `docs/PRD.md` §9 exactly. Rules of thumb when adding new code:

- Does it need to run without a CLI or browser? → `packages/core/src/<domain-folder>/`
- Is it a terminal command? → `packages/cli/src/commands/`
- Is it demo-only, never published? → `apps/demo/`
- `core` must never `import` from `cli` or `apps/demo`. Dependency direction is one-way:
  `cli` → `core`, `apps/demo` → `core`.
- Every new module in `core` gets a same-named test file under `packages/core/test/`,
  mirroring the `src/` path.
- Public API surface of `core` is only what's re-exported from `src/index.ts`. Internal
  modules (`attestation/`, `forwarder/`, etc.) are implementation detail — don't let consumers
  reach into them directly.

## 4. Definition of Done (per deliverable, per PRD §12)

A deliverable isn't done when the code merges — it's done when the evidence exists:

- Core SDK: repo public, published to npm, coverage report ≥90% captured, one real testnet
  `receive()` execution log saved.
- CLI: published to npm, screenshot/log of all 4 commands' JSON output captured.
- Demo: live mainnet URL reachable, `stellar.toml` published, PR opened against
  `stellar/stellar-protocol`, video recorded.

Don't mark a weekly milestone (PRD §10) complete without its exit criteria met.

## 5. Usability Defaults

- Every public function and CLI command needs a one-line JSDoc/help description and a
  runnable example in its README — a new anchor engineer should get from `npm install` to a
  working `receive()` call in under 15 minutes without reading source.
- CLI errors are actionable: include what failed, why, and the next step (e.g. "trustline
  missing — pass `--allow-trustline-creation` to auto-create, capped at 2 XLM").
- All CLI output is valid JSON on stdout, human context on stderr — so it stays scriptable.

## 6. Commit / PR Hygiene

- Small, reviewable PRs scoped to one deliverable slice (e.g. "attestation polling with
  backoff + tests," not "core SDK").
- PR description states: what changed, which PRD requirement it satisfies, test evidence
  (coverage delta), and a completed security checklist (§2) if applicable.
- No `console.log` left in `core`/`cli` src — use the structured logger.
