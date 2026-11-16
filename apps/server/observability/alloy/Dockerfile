# Build context: apps/server/observability/alloy, not the monorepo root.
FROM grafana/alloy:v1.20.1@sha256:2aa2099af76c0098d4af7a4d6e48f86cb66dc1a000222ad927a1c67c6542d13f
COPY config.alloy /etc/alloy/config.alloy
ENV PORT=12345 GOMEMLIMIT=192MiB GOMAXPROCS=1
EXPOSE 12345
# Railway's health check probes $PORT, which a runtime variable can override, so listen on it.
ENTRYPOINT ["/bin/sh", "-c", "exec /bin/alloy run --server.http.listen-addr=\"[::]:${PORT}\" --storage.path=/var/lib/alloy/data --disable-reporting /etc/alloy/config.alloy"]
