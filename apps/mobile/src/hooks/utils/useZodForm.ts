import { Result, Schema, SchemaIssue } from "effect";
import type {
  FieldErrors,
  FieldValues,
  Resolver,
  UseFormProps,
  UseFormReturn,
} from "react-hook-form";
import { get, set, useForm } from "react-hook-form";

function setErrorAtPath(
  errors: FieldErrors,
  path: readonly PropertyKey[],
  message: string,
) {
  const fieldName = path.join(".");

  if (!fieldName || get(errors, fieldName)) {
    return;
  }

  // Nested so react-hook-form finds `platforms.0.title` by walking the path.
  set(errors, fieldName, {
    type: "schema",
    message,
  });
}

const formatIssue = SchemaIssue.makeFormatterDefault();

function childIssues(issue: SchemaIssue.Issue): readonly SchemaIssue.Issue[] {
  if ("issues" in issue) {
    return issue.issues;
  }
  // Filters from struct-level `.check(...)` wrap their Pointer in `issue`.
  if ("issue" in issue) {
    return [issue.issue];
  }
  return [];
}

/**
 * Report each failure at its deepest field. Pointer paths are relative to
 * their parent, so the full path accumulates while descending. Returns
 * whether any field error was found below `issue`.
 */
function collectFieldErrors(
  issue: SchemaIssue.Issue,
  errors: FieldErrors,
  path: readonly PropertyKey[] = [],
): boolean {
  if (issue._tag === "Pointer") {
    const fieldPath = [...path, ...issue.path];
    if (!collectFieldErrors(issue.issue, errors, fieldPath)) {
      setErrorAtPath(errors, fieldPath, formatIssue(issue.issue));
    }
    return true;
  }

  let found = false;
  for (const child of childIssues(issue)) {
    found = collectFieldErrors(child, errors, path) || found;
  }
  return found;
}

function schemaResolver<TOutput extends FieldValues>(
  schema: Schema.ConstraintDecoder<TOutput>,
): Resolver<TOutput> {
  return (values) => {
    const result = Schema.decodeUnknownResult(schema)(values);

    if (Result.isSuccess(result)) {
      return {
        values: result.success,
        errors: {},
      };
    }

    const errors: FieldErrors<TOutput> = {};
    collectFieldErrors(result.failure.issue, errors);

    return {
      values: {},
      errors,
    };
  };
}

export const useZodForm = <TOutput extends FieldValues>({
  schema,
  ...formConfig
}: { schema: Schema.ConstraintDecoder<TOutput> } & Omit<
  UseFormProps<TOutput>,
  "resolver"
>): UseFormReturn<TOutput> =>
  useForm<TOutput>({
    ...formConfig,
    resolver: schemaResolver(schema),
  });
