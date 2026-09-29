const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// `decode-uri-component` (pulled in by @react-navigation/core → query-string)
// shipped 0.2.x without a `main` field, which Metro can't resolve; 0.5.x adds an
// `exports` map that forbids the `./index.js` subpath. Resolving the bare name
// works for both, so redirect Metro to whatever Node picks.
const decodeUriComponentEntry = require.resolve("decode-uri-component", {
  paths: [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
  ],
});
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "decode-uri-component") {
    return { type: "sourceFile", filePath: decodeUriComponentEntry };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
