# The k6 load generator that runs as the `hccna-bench` Railway service.
#
# Build context is the monorepo root, the same as the other images and what `railway up` uploads:
#   docker build -f apps/server-rs/bench/Dockerfile .
# Railway: Dockerfile path apps/server-rs/bench/Dockerfile, restart policy "never".
#
# One deployment runs one scenario against one target and exits. Choose them with variables
# (SCENARIO plus the ones listed in RUNBOOK.md); redeploy to run again.
FROM grafana/k6:1.5.0

COPY apps/server-rs/bench/k6 /bench/k6
COPY apps/server-rs/bench/operations.json /bench/operations.json

ENV SCENARIO=warm \
    K6_NO_USAGE_REPORT=true
WORKDIR /bench

# The summary is JSON Lines on stdout; progress and a readable table go to stderr.
ENTRYPOINT ["/bin/sh", "-c", "case \"$SCENARIO\" in warm|resolver|cold) exec k6 run --quiet \"/bench/k6/$SCENARIO.js\" ;; *) echo \"SCENARIO must be warm, resolver or cold (got: $SCENARIO)\" >&2; exit 2 ;; esac"]
