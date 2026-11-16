import { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgCaretRight = (props: SvgProps) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 20 20"
    {...props}
  >
    <Path
      fill="currentColor"
      d="m14.413 10.663-6.25 6.25a.939.939 0 1 1-1.328-1.328L12.422 10 6.837 4.413a.939.939 0 1 1 1.328-1.328l6.25 6.25a.936.936 0 0 1-.002 1.328"
    />
  </Svg>
);
export default SvgCaretRight;
