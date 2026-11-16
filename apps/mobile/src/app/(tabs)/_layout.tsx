import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Tabs } from "expo-router";

import { TabBar } from "@/components/navigation/TabBar";
import SvgHome from "@/icons/Home";
import { useAppTheme } from "@/theme/useAppTheme";

export const unstable_settings = {
  anchor: "index",
};

export default function TabLayout() {
  const { colors } = useAppTheme();

  return (
    // Inactive tabs stay mounted without react-freeze; Expo Router 58 never
    // freezes them. With React 19, updates that reach a frozen subtree
    // (navigator context, Relay data, Animated/Reanimated props, BlurView
    // state) can never be processed: every root render re-attempts the hidden
    // tree, react-freeze throws, the work is discarded, and the pending lanes
    // stay behind. On Android that produced a continuous ~7 Hz loop of ~180 ms
    // whole-tree renders after each tab switch. Native detachment
    // (`detachInactiveScreens`) stops layout and draw for inactive tabs, and
    // the carousels pause on blur via `useIsFocused`.
    <Tabs
      backBehavior="history"
      detachInactiveScreens
      screenOptions={{
        animation: "none",
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
      }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <SvgHome width={size} height={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome6 name="calendar-day" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sermons"
        options={{
          title: "Sermons",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome6 name="book-open" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="give"
        options={{
          title: "Giving",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome6 name="hand-holding-heart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <FontAwesome6 name="ellipsis" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
