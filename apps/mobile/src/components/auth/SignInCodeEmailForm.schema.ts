import { Schema } from "effect";

import { EmailString } from "@/utils/effectSchema";

export const signInCodeEmailSchema = Schema.Struct({
  email: EmailString,
});

export type FormValues = typeof signInCodeEmailSchema.Type;
