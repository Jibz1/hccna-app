import { Context } from "effect";

import type { AppCollections, FBPaths } from "@/utils/firebase";
import type { App } from "firebase-admin/app";
import type { FieldPath, FieldValue, Firestore } from "firebase-admin/firestore";

export class FirebaseAdminContext extends Context.Service<
	FirebaseAdminContext,
	{
		app: App;
		secondaryApp: App;
		db: Firestore;
		secondaryDb: Firestore;
		dbFieldValue: typeof FieldValue;
		fieldPath: typeof FieldPath;
		FBPaths: typeof FBPaths;
		AppCollections: typeof AppCollections;
	}
>()("FirebaseAdminContext") {}
