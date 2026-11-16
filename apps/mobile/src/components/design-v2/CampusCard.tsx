import { cva, type VariantProps } from "class-variance-authority";
import { Pressable, type PressableProps } from "react-native";

const campusCardVariants = cva(
  "border-continuous min-h-45 justify-between gap-3 rounded-[28px] p-4 active:opacity-60",
  {
    variants: {
      isPreferred: {
        true: "dark:bg-design-selected bg-white",
        false: "bg-design-surface",
      },
      isSingleColumn: {
        true: "w-full",
        false: "w-[48%]",
      },
    },
    defaultVariants: {
      isPreferred: false,
      isSingleColumn: false,
    },
  },
);

type CampusCardProps = PressableProps & VariantProps<typeof campusCardVariants>;

export function CampusCard({
  isPreferred,
  isSingleColumn,
  className,
  ...props
}: CampusCardProps) {
  return (
    <Pressable
      {...props}
      className={campusCardVariants({ isPreferred, isSingleColumn, className })}
    />
  );
}
