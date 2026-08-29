# Contributing

Thanks for your interest in improving OPD Sharing. This project only accepts changes through pull requests — nobody, including maintainers, pushes directly to `main`.

## Setup

1. Fork the repo and clone your fork.
2. Install dependencies:
   ```
   pnpm install
   ```
3. Copy `.env.local` from a maintainer or set up your own [Convex](https://convex.dev) + [Clerk](https://clerk.com) dev instances — the app needs `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, and `VITE_CLERK_PUBLISHABLE_KEY` at minimum.
4. Run the backend and frontend in separate terminals:
   ```
   npx convex dev
   pnpm dev
   ```

## Making a change

1. Create a branch off `main` for your change.
2. Keep the change focused — small, single-purpose PRs are much easier to review than large ones.
3. Before opening a PR, make sure these pass locally:
   ```
   pnpm build
   pnpm lint
   ```
4. Open a pull request against `main` with a clear description of what changed and why. The PR template will prompt you for the details reviewers need.
5. A CI check runs typecheck/build/lint automatically on every PR — it must pass before merging.

## Code style

- Match the existing patterns in the file you're editing rather than introducing a new style.
- Prefer editing existing components/functions over adding new abstractions unless the change genuinely needs one.
- No unnecessary comments — code should read clearly on its own; comment only non-obvious *why*, not *what*.

## Reporting bugs / requesting features

Open a GitHub issue with steps to reproduce (for bugs) or the use case you're trying to solve (for features).
