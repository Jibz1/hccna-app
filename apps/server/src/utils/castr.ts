import { CastrService } from "@/effect/services/CastrService";
import { Effect } from "effect";

import type { UpdatePlatformRequest } from "./castr/index";

export const patchCastrPlatformEffect = ({
	streamId,
	platformId,
	data,
}: {
	streamId: string;
	platformId: string;
	data: UpdatePlatformRequest;
}) =>
	Effect.gen(function* () {
		const castrService = yield* CastrService;
		return yield* castrService.patchPlatform({ streamId, platformId, data });
	});
