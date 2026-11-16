import { cva } from "class-variance-authority";

export const textStyles = cva("tracking-normal", {
  variants: {
    size: {
      sm: "text-label-xs font-sans font-regular",
      md: "text-label font-sans font-regular",
      lg: "text-heading-lg font-sans-medium",
      xl: "text-heading-xl font-sans-medium",
    },
    error: {
      true: "text-content-negative",
      false: "text-content-primary",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export const baseInputStyle = cva(
  "z-10 flex-1 grow w-full h-full outline-none placeholder:text-content-persistentWhite-op64",
  {
    variants: {
      size: {
        sm: "text-p-sm font-sans",
        md: "text-label font-sans",
        lg: "text-heading-lg font-sans-bold",
        xl: "text-heading-xl font-sans-bold",
      },
      editable: {
        true: null,
        false: null, // TODO
      },
      error: {
        true: "text-content-primary",
        false: "text-content-primary",
      },
    },
    defaultVariants: {
      editable: true,
      error: false,
      size: "md",
    },
  },
);
