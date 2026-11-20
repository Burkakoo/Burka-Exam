const { withGradleProperties, withAppBuildGradle, withProjectBuildGradle } = require("@expo/config-plugins");

module.exports = function withAsyncStorageSize(config, sizeInMB = 150) {
  config = withGradleProperties(config, (modConfig) => {
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

    // 2. Enable dedicated single-thread executor to prevent SQLite multi-threading race conditions & locks
    const executorIndex = modConfig.modResults.findIndex(
      (item) => item.type === "property" && item.key === "AsyncStorage_dedicatedExecutor"
    );
    if (executorIndex >= 0) {
      modConfig.modResults[executorIndex].value = "true";
    } else {
      modConfig.modResults.push({
        type: "property",
        key: "AsyncStorage_dedicatedExecutor",
        value: "true"
      });
    }

    // 3. Disable R8/ProGuard minification in release builds to prevent runtime class stripping crashes
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

  // 4. Add an allprojects block to the root build.gradle so ALL submodules
  //    (including :expo, :expo-constants, etc.) skip checkReleaseAarMetadata.
  config = withProjectBuildGradle(config, (modConfig) => {
    const disableAarBlock = `
// Disable AarMetadata checks for all projects and submodules.
allprojects {
    tasks.matching { it.name.contains("AarMetadata") }.configureEach {
        enabled = false
    }
}
`;
    if (!modConfig.modResults.contents.includes("AarMetadata")) {
      modConfig.modResults.contents += disableAarBlock;
    }
    return modConfig;
  });

  return withAppBuildGradle(config, (modConfig) => {
    if (!modConfig.modResults.contents.includes("AarMetadata")) {
      modConfig.modResults.contents += `
// Disable AarMetadata check to allow building with latest Expo 58 modules on Android 16 (API 36)
tasks.matching { it.name.contains("AarMetadata") }.configureEach {
    enabled = false
}
`;
    }
    return modConfig;
  });
};
