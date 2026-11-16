import { Predicate } from "effect";
import { Stack as NativeStack } from "expo-router";
import React from "react";

import { BOTTOM_SHEET, DEFAULT_STACK_HEADER } from "./Stack.options";

export default function Stack({
  screenOptions,
  children,
  ...props
}: React.ComponentProps<typeof NativeStack>) {
  const resolvedScreenOptions: React.ComponentProps<
    typeof NativeStack
  >["screenOptions"] = Predicate.isFunction(screenOptions)
    ? (options) => ({
        ...DEFAULT_STACK_HEADER,
        ...screenOptions(options),
      })
    : {
        ...DEFAULT_STACK_HEADER,
        ...screenOptions,
      };

  const processedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      const { sheet, modal, ...props } = child.props as any;
      if (sheet) {
        return React.cloneElement(child, {
          ...props,
          options: {
            ...BOTTOM_SHEET,
            ...props.options,
          },
        });
      } else if (modal) {
        return React.cloneElement(child, {
          ...props,
          options: {
            presentation: "modal",
            ...props.options,
          },
        });
      }
    }
    return child;
  });

  return (
    <NativeStack
      screenOptions={resolvedScreenOptions}
      {...props}
      // oxlint-disable-next-line react/no-children-prop -- intentional: children are pre-processed before passing
      children={processedChildren}
    />
  );
}

Stack.Screen = NativeStack.Screen as React.FC<
  React.ComponentProps<typeof NativeStack.Screen> & {
    /** Make the sheet open as a bottom sheet with default options on iOS. */
    sheet?: boolean;
    /** Make the screen open as a modal. */
    modal?: boolean;
  }
>;
