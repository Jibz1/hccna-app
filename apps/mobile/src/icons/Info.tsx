import { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgInfo = (props: SvgProps) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 12 12"
    {...props}
  >
    <Path
      fill="currentColor"
      fillRule="evenodd"
      d="M5.018 1.482a.982.982 0 1 0 1.964 0 .982.982 0 0 0-1.964 0m-.393 1.964a.59.59 0 1 0 0 1.179h.786v5.696H3.839a.59.59 0 0 0 0 1.179h4.322a.59.59 0 1 0 0-1.179H6.589V4.036A.59.59 0 0 0 6 3.446z"
      clipRule="evenodd"
    />
  </Svg>
);
export default SvgInfo;
