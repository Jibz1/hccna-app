# Effect Execution Boundaries

The backend executes Effects only at application and transport boundaries: app bootstrap may run the main program through the managed runtime, Hono handlers use the Hono Effect adapter, GraphQL resolvers use the request-scoped GraphQL Effect runner during migration, and tests may call `Effect.runPromise` directly. Business logic and services return `Effect` values instead of executing them, matching the vendored Effect pattern where `ManagedRuntime.make` is created at the edge, used to run a program, and then disposed.

Direct `Effect.runPromise` calls in production GraphQL modules are migration debt and should be replaced with request-scoped execution or moved behind Effect services as those resolver slices are migrated.

Promise-based callback adapters required by third-party libraries are allowed to execute Effects internally when the adapter object itself is the boundary. The underlying operations should remain named `Effect.fn` programs, and the `Effect.runPromise` calls should stay isolated inside the adapter object rather than spreading into domain services or resolver logic.

Enforcement is ratcheted through `scripts/check-effect-boundaries.ts`: existing migration debt is explicitly listed, new direct Effect execution outside approved boundary files fails CI, and the allowlist should shrink as resolver and service slices are migrated.
