import type { VariantProps } from "class-variance-authority";
import { useCallback, useMemo, type Ref } from "react";
import { type TextInputInstance, TextInputProps } from "react-native";
import { TextInput } from "react-native-gesture-handler";

import { baseInputStyle, textStyles } from "@/ui/BaseInput.styles";
import { composeRefs } from "@/utils/composeRefs";
import { scheduleIdleTask } from "@/utils/scheduleIdleTask";

export type BaseInputProps = TextInputProps &
  VariantProps<typeof baseInputStyle> &
  VariantProps<typeof textStyles>;

export function BaseInput({
  className,
  editable,
  error,
  size,
  autoFocus: autoFocusRequested,
  ref,
  ...props
}: BaseInputProps & { ref?: Ref<TextInputInstance> }) {
  // HACK XXX TODO - vaul sheets are buggy on mobile web. vaul tries to
  // transform its container to avoid the keyboard, but this can cause the
  // container to get squashed or positioned strangely if the content
  // includes an autofocused input.
  //
  // Setting the focus imperatively mitigates the issue.
  const focusRef = useCallback(
    (input: TextInputInstance | null) => {
      if (autoFocusRequested && input && !input.isFocused()) {
        const task = scheduleIdleTask(() => {
          input.focus();
        });
        return () => {
          task.cancel();
        };
      }
    },
    [autoFocusRequested],
  );
  const inputRef = useMemo(() => composeRefs(ref, focusRef), [ref, focusRef]);

  return (
    <TextInput
      ref={inputRef}
      editable={editable}
      // inputMode wins over keyboardType in React Native, so only set it for
      // the numeric case; otherwise "email-address" and friends are lost.
      inputMode={props.keyboardType === "numeric" ? "decimal" : undefined}
      {...props}
      className={baseInputStyle({ editable, error, size, className })}
    />
  );
}
