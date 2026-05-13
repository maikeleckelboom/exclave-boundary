import dts from "rollup-plugin-dts";

const external = [
  "@seqlok/base",
  "@seqlok/primitives",
  "@seqlok/core",
  "@seqlok/commands",
];

export default [
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.d.ts",
      format: "es",
    },
    plugins: [
      dts({
        tsconfig: "tsconfig.json",
        respectExternal: true,
      }),
    ],
    external,
  },
];
