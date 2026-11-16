import "lottie-react-native";

declare module "lottie-react-native" {
  export interface LottieViewProps extends AnimatedLottieViewProps {
    className?: string;
  }
}
