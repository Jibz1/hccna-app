import { loadAppConfigSync } from "@/effect/AppConfig";
import { RedisClient } from "bun";

const {
	redis: { connectionUrl },
} = loadAppConfigSync();

export const redis = new RedisClient(connectionUrl);
