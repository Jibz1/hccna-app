import { createCCBFormsDataLoader } from "./ccbFormsDataLoader";
import { createDatabaseProfileLoaders } from "./databaseProfileDataLoader";
import { createUserProfileDataLoader } from "./firebaseDataLoader";
import { createStreamMetadataDataLoader } from "./streamMetadataDataLoader";
import { createWOADataLoader } from "./woaDataLoader";

import type { EffectRunner } from "@/effect/DataLoaderFactory";

export function createRequestLoaders<RProvided = unknown>(
	runPromise: EffectRunner<RProvided>,
	currentUserUid?: string | null,
): CommonDataLoader {
	return {
		...createDatabaseProfileLoaders(runPromise, currentUserUid),
		userProfile: createUserProfileDataLoader(runPromise),
		ccbForms: createCCBFormsDataLoader(),
		woa: createWOADataLoader(runPromise),
		streamMetadata: createStreamMetadataDataLoader(runPromise),
	};
}

export interface CommonDataLoader extends ReturnType<typeof createDatabaseProfileLoaders> {
	userProfile: ReturnType<typeof createUserProfileDataLoader>;
	ccbForms: ReturnType<typeof createCCBFormsDataLoader>;
	woa: ReturnType<typeof createWOADataLoader>;
	streamMetadata: ReturnType<typeof createStreamMetadataDataLoader>;
}
