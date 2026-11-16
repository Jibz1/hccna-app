import { prometheus } from "@hono/prometheus";
import { Registry } from "prom-client";

export const prometheusRegistry = new Registry();

export const { printMetrics, registerMetrics } = prometheus({ registry: prometheusRegistry });
