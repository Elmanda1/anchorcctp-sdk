# From source

For contributors: run the monorepo locally.

```bash
git clone https://github.com/Elmanda1/anchorcctp-sdk.git
cd anchorcctp-sdk
npm install
npm run build
```

Layout:

* `packages/core` holds the publishable engine.
* `packages/cli` holds the terminal suite.
* `apps/demo` holds the reference portal. It never publishes to npm.
* `apps/docs` holds this site. It never publishes to npm.

Dependency direction runs one way: `cli` imports from `core`, `demo` imports from `core`. Core never imports from CLI or demo. Keep it that way so the SDK stays embeddable without CLI or React dependencies.

Next: [Verify the install](./verify) for lint, typecheck, and coverage.
