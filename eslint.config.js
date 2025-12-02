import coreConfig from "./packages/core/eslint.config.js";
import hotswapConfig from "./packages/hotswap/eslint.config.js";
import baseConfig from "./packages/base/eslint.config.js";
import primitivesConfig from "./packages/primitives/eslint.config.js";
import introspectConfig from "./packages/introspect/eslint.config.js";
import commandsConfig from "./packages/commands/eslint.config.js";
import integrationConfig from "./packages/integration/eslint.config.js";

function prefixPackage(blocks, pkgRoot) {
  return blocks.map((block) => {
    if (!block) return block;
    if (!("files" in block) || !block.files) return block;

    const prefix = (pattern) =>
      pattern.startsWith(`${pkgRoot}/`) ? pattern : `${pkgRoot}/${pattern}`;

    return {
      ...block,
      files: block.files.map(prefix),
    };
  });
}

export default [
  ...prefixPackage(coreConfig, "packages/core"),
  ...prefixPackage(hotswapConfig, "packages/hotswap"),
  ...prefixPackage(baseConfig, "packages/base"),
  ...prefixPackage(primitivesConfig, "packages/primitives"),
  ...prefixPackage(introspectConfig, "packages/introspect"),
  ...prefixPackage(commandsConfig, "packages/commands"),
  ...prefixPackage(integrationConfig, "packages/integration"),
];
