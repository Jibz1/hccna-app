import { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";

import { StyledSvg as Svg } from "@/cssInterop";

const SvgX12 = (props: SvgProps) => (
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
      d="M1.536 1.199a1 1 0 0 0-.105.041.7.7 0 0 0-.193.197.51.51 0 0 0 .006.495c.02.035.754.777 2.036 2.061L5.286 6 3.28 8.007c-1.277 1.279-2.016 2.027-2.036 2.061a.505.505 0 0 0 .133.653.51.51 0 0 0 .555.035c.034-.02.782-.759 2.061-2.036L6 6.714 8.007 8.72c1.279 1.277 2.027 2.016 2.061 2.036a.51.51 0 0 0 .555-.035.505.505 0 0 0 .133-.653c-.02-.034-.759-.782-2.036-2.061L6.714 6 8.72 3.993c1.277-1.279 2.016-2.027 2.036-2.061a.51.51 0 0 0-.035-.555.505.505 0 0 0-.653-.133c-.034.02-.782.759-2.061 2.036L6 5.286 3.993 3.28C2.709 1.998 1.967 1.264 1.932 1.244a.5.5 0 0 0-.396-.045"
      clipRule="evenodd"
    />
  </Svg>
);
export default SvgX12;
