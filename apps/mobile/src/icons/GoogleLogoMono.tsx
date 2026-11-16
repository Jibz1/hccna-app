import { ClipPath, Defs, G, Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgGoogleLogoMono = (props: SvgProps) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 16 16"
    width={24}
    height={24}
    {...props}
  >
    <G clipPath="url(#google_logo_mono_svg__a)">
      <Path
        fill="currentColor"
        d="M13.373 6.554H8.628a.63.63 0 0 0-.628.64v1.737a.63.63 0 0 0 .628.628h3.266A3.38 3.38 0 0 1 9.6 12.828c-.451.153-.93.21-1.404.167-2.76 0-4.09-2.34-4.09-5s1.429-5 4.09-5a5.02 5.02 0 0 1 3.253 1.06.604.604 0 0 0 .888-.272l.776-1.773a.63.63 0 0 0-.185-.776A8.7 8.7 0 0 0 8.247.003C3.76-.01.705 3.475.705 7.995S3.774 16 8.197 16c4.424 0 7.098-3.153 7.098-7.39 0-1.354-.542-2.056-1.922-2.056"
      />
    </G>
    <Defs>
      <ClipPath id="google_logo_mono_svg__a">
        <Path fill="currentColor" d="M0 0h16v16H0z" />
      </ClipPath>
    </Defs>
  </Svg>
);
export default SvgGoogleLogoMono;
