import { Suspense, useState } from "react";
import { View } from "react-native";
import { graphql, useLazyLoadQuery } from "react-relay";

import { FullLoadingState } from "@/components/layout/FullLoadingState";
import { MoreRow, MoreSection } from "@/components/more/MoreSection";
import {
  ErrorBoundaryWithRetry,
  useRetryKey,
} from "@/components/providers/ErrorBoundaryWithRetry";

import { CCBFormsQuery } from "./__generated__/CCBFormsQuery.graphql";

function CCBform({ initiallyExpanded }: { initiallyExpanded: boolean }) {
  const fetchKey = useRetryKey();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const { ccbFormsV2 } = useLazyLoadQuery<CCBFormsQuery>(
    graphql`
      query CCBFormsQuery {
        ccbFormsV2 {
          __typename
          ... on CCBFormsSuccess {
            forms {
              title
              url
            }
          }
          ... on CCBFormsFetchError {
            message
          }
          ... on CCBFormsNotFoundError {
            message
          }
        }
      }
    `,
    {},
    {
      fetchPolicy: "store-or-network",
      fetchKey,
    },
  );

  const ccbForms =
    ccbFormsV2?.__typename === "CCBFormsSuccess" ? ccbFormsV2.forms : null;

  if (!ccbForms) {
    if (
      ccbFormsV2?.__typename === "CCBFormsFetchError" ||
      ccbFormsV2?.__typename === "CCBFormsNotFoundError"
    ) {
      console.error("Failed to fetch CCB forms:", ccbFormsV2.message);
    }

    return null;
  }

  const forms = ccbForms.filter((form) => form.url?.trim());
  if (forms.length === 0) {
    return null;
  }

  return (
    <MoreSection title="Take your next step">
      <MoreRow
        title="Forms & registrations"
        subtitle="Sign up and get involved"
        icon="clipboard-list"
        expanded={expanded}
        onPress={() => {
          setExpanded((value) => !value);
        }}
        last={!expanded}
      />
      {expanded ? (
        <View>
          {forms.map((form, index) => (
            <MoreRow
              key={`${form.url}-${index}`}
              title={form.title?.trim() ? form.title : "Registration form"}
              href={form.url!}
              icon="file-lines"
              last={index === forms.length - 1}
            />
          ))}
        </View>
      ) : null}
    </MoreSection>
  );
}

export function CCBForm({
  initiallyExpanded = false,
}: {
  initiallyExpanded?: boolean;
}) {
  return (
    <ErrorBoundaryWithRetry>
      <Suspense fallback=<FullLoadingState />>
        <CCBform initiallyExpanded={initiallyExpanded} />
      </Suspense>
    </ErrorBoundaryWithRetry>
  );
}
