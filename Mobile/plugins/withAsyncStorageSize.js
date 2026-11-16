const { withGradleProperties } = require("@expo/config-plugins");

module.exports = function withAsyncStorageSize(config, sizeInMB = 150) {
  return withGradleProperties(config, (modConfig) => {
    if (!Array.isArray(modConfig.modResults)) {
      modConfig.modResults = [];
    }
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
    return modConfig;
  });
};
