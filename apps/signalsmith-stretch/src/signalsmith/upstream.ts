export const SIGNALSMITH_STRETCH_SOURCE_BRANCH = "performance/output-seek";
export const SIGNALSMITH_STRETCH_REF =
  "14f83ada78c772683c31c6e3f0c0497a4fbdb0df";
export const SIGNALSMITH_STRETCH_REPO =
  "https://github.com/Signalsmith-Audio/signalsmith-stretch.git";

export const SIGNALSMITH_LINEAR_SOURCE_TAG = "0.3.0";
export const SIGNALSMITH_LINEAR_REF =
  "a436c9a53bddd65492a73f6e2dbf02af17ca8820";
export const SIGNALSMITH_LINEAR_REPO =
  "https://github.com/Signalsmith-Audio/linear.git";

export const SIGNALSMITH_UPSTREAM = {
  linear: {
    ref: SIGNALSMITH_LINEAR_REF,
    repo: SIGNALSMITH_LINEAR_REPO,
    sourceTag: SIGNALSMITH_LINEAR_SOURCE_TAG,
  },
  stretch: {
    ref: SIGNALSMITH_STRETCH_REF,
    repo: SIGNALSMITH_STRETCH_REPO,
    sourceBranch: SIGNALSMITH_STRETCH_SOURCE_BRANCH,
  },
} as const;
