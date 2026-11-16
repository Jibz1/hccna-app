import { ClipPath, Defs, G, Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgAppleLogoMono = (props: SvgProps) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 16 16"
    width={24}
    height={24}
    {...props}
  >
    <G clipPath="url(#apple_logo_mono_svg__a)">
      <Path
        fill="currentColor"
        fillRule="evenodd"
        d="M11.588 1.463A.857.857 0 0 0 10.376.251L9.05 1.575a.857.857 0 1 0 1.213 1.212zm-1.59 2.035a3.93 3.93 0 0 1 4.184 1.984.572.572 0 0 1-.33.817 2.3 2.3 0 0 0-1.607 2.19v.008a2.29 2.29 0 0 0 1.974 2.307.572.572 0 0 1 .476.708 8.16 8.16 0 0 1-2.135 3.745 2.95 2.95 0 0 1-3.794.095.95.95 0 0 0-1.12.004c-.54.407-1.231.68-1.963.64-.731-.04-1.395-.39-1.886-.856a8.93 8.93 0 0 1-2.41-5.188 6.5 6.5 0 0 1 .683-4.221 4.134 4.134 0 0 1 5.885-1.62.58.58 0 0 0 .556.005 3.9 3.9 0 0 1 1.487-.618"
        clipRule="evenodd"
      />
    </G>
    <Defs>
      <ClipPath id="apple_logo_mono_svg__a">
        <Path fill="currentColor" d="M0 0h16v16H0z" />
      </ClipPath>
    </Defs>
  </Svg>
);
export default SvgAppleLogoMono;
