# Evidence

For reviewers and milestone owners: proof that each deliverable runs.

A milestone closes when its artifacts exist, not when code merges. Artifacts live in `docs/evidence/` in the repo. The numbered index is [`docs/evidence/README.md`](https://github.com/Elmanda1/anchorcctp-sdk/blob/main/docs/evidence/README.md); each row there names its own status and, where a gap exists, the gap.

| ID | Artifact | File |
|---|---|---|
| L01 | Test coverage report | `coverage.md` |
| L02 | Cross-chain settlement record (Base Sepolia → Stellar testnet) | `core-receive-sepolia.log` |
| L03–L07 | CLI recordings and JSON output log | `cli-domains.gif`, `cli-init.gif`, `cli-listen.gif`, `cli-verify.gif`, `cli-commands.log` |
| L08 | Demo deployment plus live `stellar.toml` | `demo-deploy.md` |
| L09–L10 | Demo portal and docs site screenshots | `ui-demo-portal.png`, `ui-docs-site.png` |
| L11 | Demo UI balance refresh and error panel | `ui-balance-refresh.md` |
| L12 | SEP protocol PR link | `sep-pr-link.md` |
| L13 | Mainnet end-to-end record | `mainnet-e2e.md` (placeholder — do not cite) |

Coverage figures live in `coverage.md` rather than in a committed HTML report; build and test output is gitignored.

When you open a PR, link the evidence file or log excerpt that matches the claim. If an artifact is missing, the milestone stays open.

Next: start a new integration at [What is AnchorCCTP](/overview/what) or [Quick setup](/start/quick-setup).
