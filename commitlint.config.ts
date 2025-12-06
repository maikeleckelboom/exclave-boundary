import type { UserConfig } from "@commitlint/types";
import { RuleConfigSeverity } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      RuleConfigSeverity.Error,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "test",
        "build",
        "ci",
        "perf",
        "style",
        "revert",
      ],
    ],
    "scope-empty": [RuleConfigSeverity.Error, "never"],
    "scope-case": [RuleConfigSeverity.Error, "always", "kebab-case"],
    "subject-empty": [RuleConfigSeverity.Error, "never"],
    "subject-full-stop": [RuleConfigSeverity.Error, "never", "."],
    "header-max-length": [RuleConfigSeverity.Error, "always", 100],
    "body-leading-blank": [RuleConfigSeverity.Error, "always"],
    "body-max-line-length": [RuleConfigSeverity.Error, "always", 100],
    "subject-case": [RuleConfigSeverity.Disabled],
    "type-case": [RuleConfigSeverity.Disabled],
    "scope-enum": [RuleConfigSeverity.Disabled],
  },
};

export default config;
