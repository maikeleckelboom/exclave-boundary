import dts from "rollup-plugin-dts";

const external: readonly string[] = [];

export default [
  {
    input: "src/index.ts",
    output: { file: "dist/index.d.ts", format: "es" },
    external,
    plugins: [
      dts({
        tsconfig: "tsconfig.json",
        respectExternal: true,
      }),
    ],
  },
  {
    input: "src/worklet/index.ts",
    output: { file: "dist/worklet.d.ts", format: "es" },
    external,
    plugins: [
      dts({
        tsconfig: "tsconfig.json",
        respectExternal: true,
      }),
    ],
  },
];
