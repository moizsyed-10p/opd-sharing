# OPD Sharing

A shared expense-reimbursement tool for groups (families, roommates, coworkers) who pool OPD (out-patient department) medical bills for reimbursement. Upload a multi-page OPD PDF, and the app automatically splits it into individually claimable "slips" — one per page — that group members claim against a shared pool, with full tracking of who claimed what and how much value is left.

## How it works

1. **Upload** — any group member uploads a multi-page OPD receipt PDF. The app splits it into per-page slips and OCRs each page for its billed amount.
2. **Share** — a group has a single invite code; anyone with it can join. Everyone in the group sees the same live pool of slips.
3. **Claim** — members claim individual slips (or use **Smart Match**, which auto-picks the best combination of unclaimed slips to hit a target reimbursement amount) and download them, merged into a single compressed PDF, ready to submit.
4. **Track** — a slip is only considered "fully used" once every claim-eligible member has claimed it. The dashboard shows per-member claim/upload stats, recent activity, and a breakdown of remaining pool value.

## Key features

- **Smart Match** — enter a target reimbursement amount and the app finds the best combination of unclaimed slips to meet it, then merges and downloads them as one PDF.
- **Per-member permissions** — admins can restrict a member to *upload only* (contributes bills to the pool but can't claim) vs *claim & upload* (full access).
- **Admin controls** — remove a member from a group, bulk-delete slips/files that are fully claimed by everyone (to free up storage), and reassign member permissions.
- **Claim reminders** — an in-app banner nudges claim-eligible members with unclaimed slips after the 15th of the month.
- **Client error logging** — failures during the claim/download flow are reported back to the backend and surfaced to admins, instead of silently vanishing into a browser console.
- **PDF handling** — client-side page splitting, OCR-based amount extraction, and automatic compression to keep merged downloads under 10MB.

## Stack

- [Convex](https://convex.dev) — backend, database, and file storage
- [Clerk](https://clerk.com) — authentication
- React + Vite + Tailwind, deployed on [Vercel](https://vercel.com)

## Getting started

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and the contribution workflow — all changes go through pull requests.

## License

[MIT](LICENSE)
