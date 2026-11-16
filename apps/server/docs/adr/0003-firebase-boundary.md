# Firebase Boundary

Firebase follows the same platform-adapter pattern used by vendored Effect platform clients: low-level Firebase services may wrap and expose raw clients when unavoidable, while business code depends on narrower Effect services such as auth, profile, media, storage, or workflow services. Raw Firestore/Firebase access in GraphQL resolvers, Hono routes, and general utilities is migration debt; new code should cross Firebase through focused Effect services that own acquisition, error mapping, logging, and lifecycle behavior.
