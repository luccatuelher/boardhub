# BoardHub

A single-file, no-build personal studio manager (projects, notes, gallery, mentors,
focus/rank). The whole app is [`index.html`](index.html); open it from any static host.
JSX is compiled in the browser by Babel (the compiled bundle is cached in IndexedDB).

## Running
Serve the folder statically (or open `index.html`). Data lives in the browser
(`localStorage` key `boardhub_v2`, backups/media in IndexedDB) and optionally syncs
through Firebase (Auth + Firestore + Storage) after sign-in on the **Sincronizar** screen.

## Tests
```
npm install
npm test
```
Unit tests (`node --test`) run the pure logic of `index.html` — sync merge, rank/decay,
sanitizer, embeds, ids — without a browser or a build. Pure blocks are wrapped in
`// @bh-test-begin <name>` / `// @bh-test-end <name>` comments; `test/harness.mjs` compiles
only those regions. Keep them free of JSX and DOM access (the sanitizer region gets a jsdom
`document`). Known bugs are encoded as `todo` tests, which flip to normal tests when fixed.

## Firebase
- Firestore data: `users/{uid}/boardhub/*` (legacy docs `state`, `notes`, `gallery`; v4 docs
  `sync-v4` and `v4_*` entities). Storage: `users/{uid}/images/sha256_<digest>_<mime>`.
- Security rules are versioned here: [`firestore.rules`](firestore.rules),
  [`storage.rules`](storage.rules) (deploy with `firebase deploy --only firestore:rules,storage`).
  Review them against your project before deploying; they were not run against the emulator.
- Storage download URLs carry a token and are readable by anyone who has the URL.

## Diagnostics and recovery
- `boardhubDiagnostics.enable()` then `.snapshot()` (browser console) is the opt-in diagnostic log.
- Backups are made automatically and before reset/import; restore them in **Sincronizar**.
- If the app crashes on startup, the error screen offers "Baixar cópia dos dados (JSON)",
  importable later in **Sincronizar**.

## Conventions
- Record ids come from `bhNewId()` (`<prefix><ms>-<12 hex>`); `bhIdTime(id)` reads the
  creation time back from old numeric and new string ids. Never rewrite existing ids.
- Dates go through `localDateISO()`; never `toISOString().slice(0,10)`.
- See [`MELHORIAS.md`](MELHORIAS.md) for the analysis and roadmap.
