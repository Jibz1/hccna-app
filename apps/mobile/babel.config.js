const REACT_COMPILER_EXCLUDE_PATTERNS = [
  /[\\/]__generated__[\\/]/,
  /\.graphql\.[jt]sx?$/,
  /[\\/]signaldb[\\/]/,
  /[\\/]environment\.[jt]sx?$/,
  /[\\/]utils[\\/]/,
];

module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: [
      [
        "babel-preset-expo",
        {
          "react-compiler": {
            compilationMode: "infer",
            panicThreshold: "critical_errors",
            sources: (filename = "") =>
              !REACT_COMPILER_EXCLUDE_PATTERNS.some((pattern) =>
                pattern.test(filename),
              ),
          },
        },
      ],
    ],
    plugins: [
      "relay",
      // The Worklets plugin must remain last.
      "react-native-worklets/plugin",
    ],
  };
};
