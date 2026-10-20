# Companion Mood Heart

A sixteen-light emotional language for AI companions. The static experience supports natural-language interpretation, saved hearts, private share links, image/card exports, and reduced-motion controls.

## Vercel live connection

Deploy the repository as a Vercel project to enable the same-origin `/api/heart` Function. The live panel supports Nomi and Kindroid without storing credentials:

- API keys remain only in the open page's JavaScript memory.
- The key is sent to the Function only when an upstream API call needs it.
- Keys are never written to local storage, cookies, URLs, logs, Git, or Vercel environment variables.
- Disconnecting or closing/reloading the page forgets the key.
- The GitHub Pages build remains a paste-only public demo because GitHub Pages cannot run Functions.

The bridge follows the official Nomi `v1` API and Kindroid `v1` API. No companion message is sent during connection except the user's explicit **Ask and animate the reply** action; Kindroid connection validation performs a one-message history read.

## Validation

Run `npm test` with Node.js 24. The test suite mocks both providers and never needs a real API key.
