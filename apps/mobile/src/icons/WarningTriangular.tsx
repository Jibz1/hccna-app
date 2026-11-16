import { ClipPath, Defs, G, Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgWarningTriangular = (props: SvgProps) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 12 12"
    {...props}
  >
    <G clipPath="url(#warning-triangular_svg__a)">
      <Path
        fill="currentColor"
        fillRule="evenodd"
        d="M4.89 1.482a1.286 1.286 0 0 1 2.22 0l4.508 7.727c.5.857-.118 1.934-1.11 1.934H1.492a1.286 1.286 0 0 1-1.11-1.934zM6 3.536c.355 0 .643.288.643.643v2.357a.643.643 0 0 1-1.286 0V4.179c0-.355.288-.643.643-.643m.857 5.357a.857.857 0 1 1-1.714 0 .857.857 0 0 1 1.714 0"
        clipRule="evenodd"
      />
    </G>
    <Defs>
      <ClipPath id="warning-triangular_svg__a">
        <Path fill="#fff" d="M0 0h12v12H0z" />
      </ClipPath>
    </Defs>
  </Svg>
);
export default SvgWarningTriangular;
