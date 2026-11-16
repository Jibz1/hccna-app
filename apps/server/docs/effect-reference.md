# Effect source reference

The server's Effect dependencies resolve to
[`effect@4.0.0`](https://github.com/Effect-TS/effect/tree/67ba4e46a11ccda0b6761578bfd22c04ae00167d),
whose upstream source is commit `67ba4e46a11ccda0b6761578bfd22c04ae00167d`.
Use that source when reproducing behavior specific to the installed release.

`repos/` lives at the monorepo root and is intentionally ignored by Git. To
recreate the reference for this release, download the
[pinned source archive](https://codeload.github.com/Effect-TS/effect/tar.gz/67ba4e46a11ccda0b6761578bfd22c04ae00167d)
and extract it into `repos/effect`, stripping the archive's top-level directory.
Use an empty destination after saving any local reference edits. Do not import
application code from this directory.

Read `repos/effect/LLMS.md` first. In this release:

- `Context.Service` and explicit `Layer.effect` definitions match our
  [service convention](adr/0001-effect-service-style.md). Effect 3 examples using
  `Effect.Service` should not drive a service migration.
- `Effect.fn("name")` defines traced service methods. `Effect.gen` expresses
  multi-step effects without extra combinator nesting.
- Recover from expected failures where the fallback is decided. A private error
  wrapper adds no useful distinction when all its variants are immediately
  handled identically. `Effect.catch` handles typed failures while preserving
  defects and interruption; see `LLMS.md`'s error-handling examples.
- `Effect.forkChild` follows the calling fiber's lifetime. Work that must survive
  a request belongs to a service scope via `Effect.forkIn`; the scope then cancels
  it at shutdown. See `packages/effect/src/Effect.ts` and
  `ai-docs/src/01_effect/05_resources/20_layer-side-effects.ts`.

These are implementation conventions. Existing HTTP and GraphQL contracts,
including error responses, remain the compatibility boundary.
