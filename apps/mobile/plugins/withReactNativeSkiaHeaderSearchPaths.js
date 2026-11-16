const { withPodfile } = require("expo/config-plugins");

const HELPER = `
def fix_react_native_skia_header_search_paths(installer)
  skia_header_paths = %w[
    "$(PODS_TARGET_SRCROOT)/cpp/api"
    "$(PODS_TARGET_SRCROOT)/cpp/skia"
    "$(PODS_TARGET_SRCROOT)/cpp/jsi"
    "$(PODS_TARGET_SRCROOT)/cpp/rnskia"
    "$(PODS_TARGET_SRCROOT)/cpp/utils"
  ]
  skia_include_flags = skia_header_paths.map { |path| "-I#{path}" }

  append_build_setting = lambda do |config, key, values|
    current_values = Array(config.build_settings[key])
    current_values = ["$(inherited)"] if current_values.empty?
    config.build_settings[key] = (current_values + values).uniq
  end

  installer.pods_project.targets.each do |target|
    next unless target.name == 'react-native-skia'

    target.build_configurations.each do |config|
      append_build_setting.call(config, 'HEADER_SEARCH_PATHS', skia_header_paths)
      append_build_setting.call(config, 'OTHER_CFLAGS', skia_include_flags)
      append_build_setting.call(config, 'OTHER_CPLUSPLUSFLAGS', skia_include_flags)
    end
  end
end
`;

function addHelper(contents) {
  const helperPattern =
    /\ndef fix_react_native_skia_header_search_paths\(installer\)[\s\S]*?\nend\n+(?=ENV\['EX_DEV_CLIENT_NETWORK_INSPECTOR'\])/;
  if (helperPattern.test(contents)) {
    return contents.replace(helperPattern, `${HELPER}\n`);
  }

  const marker = "ENV['EX_DEV_CLIENT_NETWORK_INSPECTOR']";
  if (!contents.includes(marker)) {
    throw new Error(
      "Unable to add react-native-skia header search path helper to Podfile.",
    );
  }

  return contents.replace(marker, `${HELPER}\n${marker}`);
}

function addPostInstallCall(contents) {
  const call = "    fix_react_native_skia_header_search_paths(installer)";
  if (contents.includes(call.trim())) {
    return contents;
  }

  const reactNativePostInstallPattern =
    /(\n\s+react_native_post_install\([\s\S]*?\n\s{4}\)\n)(\s{2}end\nend)/;
  if (!reactNativePostInstallPattern.test(contents)) {
    throw new Error(
      "Unable to add react-native-skia header search path call to Podfile post_install.",
    );
  }

  return contents.replace(reactNativePostInstallPattern, `$1${call}\n$2`);
}

module.exports = function withReactNativeSkiaHeaderSearchPaths(config) {
  return withPodfile(config, (config) => {
    config.modResults.contents = addPostInstallCall(
      addHelper(config.modResults.contents),
    );
    return config;
  });
};
