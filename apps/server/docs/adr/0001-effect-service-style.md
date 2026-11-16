# Effect Service Style

The backend standardizes on `Context.Service` classes with explicit `Live` layers for Effect services. This matches the vendored Effect v4 source and the existing service layer, keeps dependency wiring visible at the runtime boundary, and avoids a broad service-style migration while the backend is still moving business logic behind Effect services.
