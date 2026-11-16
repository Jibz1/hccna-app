import { useNavigation, useRoute } from "expo-router";
import { EventArg, NavigationProp } from "expo-router/react-navigation";
import * as React from "react";
import type { ScrollView } from "react-native";
import type { WebView } from "react-native-webview";

type ScrollOptions = { x?: number; y?: number; animated?: boolean };

type ScrollableView =
  | { scrollToTop(): void }
  | { scrollTo(options: ScrollOptions): void }
  | { scrollToOffset(options: { offset?: number; animated?: boolean }): void }
  | { scrollResponderScrollTo(options: ScrollOptions): void };

type ScrollableWrapper =
  | { getScrollResponder(): React.ReactNode | ScrollView }
  | { getNode(): ScrollableView }
  | ScrollableView;

function getScrollableNode(
  node: ScrollableWrapper | WebView | null,
): ScrollableWrapper | WebView | ScrollView | null {
  if (node == null) {
    return null;
  }

  if (
    "scrollToTop" in node ||
    "scrollTo" in node ||
    "scrollToOffset" in node ||
    "scrollResponderScrollTo" in node
  ) {
    // This is already a scrollable node.
    return node;
  } else if ("getScrollResponder" in node) {
    // If the view is a wrapper like FlatList, SectionList etc.
    // We need to use `getScrollResponder` to get access to the scroll responder
    const responder = node.getScrollResponder();
    // getScrollResponder can return ReactNode or ScrollView, but we need ScrollView
    return responder as ScrollView | ScrollableWrapper | null;
  } else if ("getNode" in node) {
    // When a `ScrollView` is wraped in `Animated.createAnimatedComponent`
    // we need to use `getNode` to get the ref to the actual scrollview.
    // Note that `getNode` is deprecated in newer versions of react-native
    // this is why we check if we already have a scrollable node above.
    return node.getNode();
  } else {
    return node;
  }
}

export function useScrollToTop(
  ref:
    | React.RefObject<ScrollableWrapper>
    | React.RefObject<WebView>
    | React.Ref<any>,
  offset: number = 0,
) {
  const navigation = useNavigation();
  const route = useRoute();

  React.useEffect(() => {
    const tabNavigations: NavigationProp<ReactNavigation.RootParamList>[] = [];
    let currentNavigation = navigation;

    // If the screen is nested inside multiple tab navigators, we should scroll to top for any of them
    // So we need to find all the parent tab navigators and add the listeners there
    while (currentNavigation) {
      if (currentNavigation.getState()?.type === "tab") {
        tabNavigations.push(
          currentNavigation as NavigationProp<ReactNavigation.RootParamList>,
        );
      }

      currentNavigation = currentNavigation.getParent();
    }

    if (tabNavigations.length === 0) {
      return;
    }

    const unsubscribers = tabNavigations.map((tab) => {
      return tab.addListener(
        // We don't wanna import tab types here to avoid extra deps
        // in addition, there are multiple tab implementations
        // @ts-expect-error
        "tabPress",
        (e: EventArg<"tabPress", true>) => {
          // We should scroll to top only when the screen is focused
          const isFocused = navigation.isFocused();

          // In a nested stack navigator, tab press resets the stack to first screen
          // So we should scroll to top only when we are on first screen
          const isFirst =
            tabNavigations.includes(
              navigation as NavigationProp<ReactNavigation.RootParamList>,
            ) || navigation.getState()?.routes[0].key === route.key;

          // Run the operation in the next frame so we're sure all listeners have been run
          // This is necessary to know if preventDefault() has been called
          requestAnimationFrame(() => {
            // Access ref.current inside the callback, not during render
            const refValue = (
              ref as
                | React.RefObject<ScrollableWrapper>
                | React.RefObject<WebView>
            )?.current;
            const scrollable = getScrollableNode(refValue) as
              | ScrollableWrapper
              | WebView;

            if (isFocused && isFirst && scrollable && !e.defaultPrevented) {
              if ("scrollToTop" in scrollable) {
                scrollable.scrollToTop();
              } else if ("scrollTo" in scrollable) {
                scrollable.scrollTo({ y: offset, animated: true });
              } else if ("scrollToOffset" in scrollable) {
                scrollable.scrollToOffset({ offset, animated: true });
              } else if ("scrollResponderScrollTo" in scrollable) {
                scrollable.scrollResponderScrollTo({
                  y: offset,
                  animated: true,
                });
              } else if ("injectJavaScript" in scrollable) {
                scrollable.injectJavaScript(
                  `;window.scrollTo({ top: ${offset}, behavior: 'smooth' }); true;`,
                );
              }
            }
          });
        },
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => {
        unsubscribe();
      });
    };
  }, [navigation, ref, offset, route.key]);
}
