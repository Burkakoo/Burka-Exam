const { withGradleProperties } = require("@expo/config-plugins");

module.exports = function withAsyncStorageSize(config, sizeInMB = 150) {
  return withGradleProperties(config, (modConfig) => {
    if (!Array.isArray(modConfig.modResults)) {
      modConfig.modResults = [];
    }

    // 1. Ensure AsyncStorage has 150MB database limit
    const existingIndex = modConfig.modResults.findIndex(
      (item) => item.type === "property" && item.key === "AsyncStorage_db_size_in_MB"
    );
    if (existingIndex >= 0) {
      modConfig.modResults[existingIndex].value = String(sizeInMB);
    } else {
      modConfig.modResults.push({
        type: "property",
        key: "AsyncStorage_db_size_in_MB",
        value: String(sizeInMB)
      });
    }

    // 2. Disable R8/ProGuard minification in release builds to prevent runtime class stripping crashes
    const minifyIndex = modConfig.modResults.findIndex(
      (item) => item.type === "property" && item.key === "android.enableMinifyInReleaseBuilds"
    );
    if (minifyIndex >= 0) {
      modConfig.modResults[minifyIndex].value = "false";
    } else {
      modConfig.modResults.push({
        type: "property",
        key: "android.enableMinifyInReleaseBuilds",
        value: "false"
      });
    }

    return modConfig;
  });
};
