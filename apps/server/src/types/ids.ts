import { Schema } from "effect";

export const ExportKeySchema = Schema.String.pipe(Schema.brand("ExportKey"));
export type ExportKey = typeof ExportKeySchema.Type;
