# Security policy

Meeting Helpers is a static site: there is no server, account or database. Everything a user enters (names, topics, notes, retro cards, tasks, PDF files) stays in their own browser's `localStorage` and IndexedDB. The main risks are therefore in the browser: script injection (XSS), a malicious PDF, or a dependency with a known flaw.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately through GitHub instead:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** and describe what you found, how to reproduce it and the impact you expect.

This is a small project maintained in spare time: we will look at every report as soon as we can. Once a fix is released you will be credited in the release notes, unless you prefer not to be.

## Supported versions

Only the latest version on the `main` branch (the one deployed at https://meet.sapphire-labs.dev) receives fixes.

## What is already in place

- User text is only ever inserted with `textContent`, never as HTML.
- A strict Content-Security-Policy (shared by the Sapphire Labs sites through `@sapphirelabs/ui`): scripts, styles, fonts and workers only from the site itself; inline code only with a build-time hash; no requests to other sites. The page cannot be framed (`frame-ancestors 'none'`).
- PDFs are parsed by pdf.js in a Web Worker, never run their embedded JavaScript, and are limited to 100 MB.
- Data read back from browser storage is validated before use.
- Dependencies are checked with `npm audit` in CI and updated by Dependabot; CI actions are pinned to commits.
