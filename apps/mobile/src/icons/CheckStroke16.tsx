import { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgCheckStroke16 = (props: SvgProps) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 16 16"
    {...props}
  >
    <Path
      fill="currentColor"
      d="m11.726 5.048-4.73 5.156-1.722-1.879a.72.72 0 0 0-.529-.23.72.72 0 0 0-.525.24.86.86 0 0 0-.22.573.86.86 0 0 0 .211.576l2.255 2.458c.14.153.332.24.53.24.2 0 .391-.087.532-.24l5.261-5.735A.86.86 0 0 0 13 5.63a.86.86 0 0 0-.22-.572.72.72 0 0 0-.525-.24.72.72 0 0 0-.529.23"
    />
  </Svg>
);
export default SvgCheckStroke16;
