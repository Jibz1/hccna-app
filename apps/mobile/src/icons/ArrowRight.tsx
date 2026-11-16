import { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgArrowRight = (props: SvgProps) => (
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
      d="M3 8.993h7.586l-2.293 2.29a.999.999 0 1 0 1.414 1.412l4-3.994a1 1 0 0 0 0-1.414l-4-3.995A1.001 1.001 0 0 0 7.999 4c0 .265.106.519.294.706l2.293 2.29H3a1 1 0 0 0-1 .999 1 1 0 0 0 1 .998"
    />
  </Svg>
);
export default SvgArrowRight;
