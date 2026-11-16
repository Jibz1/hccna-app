import { ClipPath, Defs, G, Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgCheck = (props: SvgProps) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 12 12"
    {...props}
  >
    <G clipPath="url(#check_svg__a)">
      <Path
        fill="currentColor"
        fillRule="evenodd"
        d="M11.686 1.146c.366.3.42.84.12 1.206l-6.724 8.22a1.714 1.714 0 0 1-2.456.204L.293 8.734a.857.857 0 0 1 1.129-1.29l2.333 2.042 6.725-8.22c.3-.366.84-.42 1.206-.12"
        clipRule="evenodd"
      />
    </G>
    <Defs>
      <ClipPath id="check_svg__a">
        <Path fill="#fff" d="M0 0h12v12H0z" />
      </ClipPath>
    </Defs>
  </Svg>
);
export default SvgCheck;
