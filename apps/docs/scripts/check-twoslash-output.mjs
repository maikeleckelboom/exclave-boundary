import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = fileURLToPath(new URL("..", import.meta.url));
const cacheDir = join(docsRoot, "src", ".vitepress", "cache", "twoslash");

const importantSnippets = [
  {
    name: "quickstart",
    marker: 'id: "quickstart/control"',
    forbidden: [
      /enabled: any/u,
      /count: any/u,
      /window: any/u,
      /status: any/u,
      /signedDelta: any/u,
      /readonly \[x: string\]: any/u,
      /value: any/u,
      /view: any/u,
    ],
  },
  {
    name: "processor example",
    marker: 'id: "examples/processor"',
    forbidden: [
      /enabled: any/u,
      /mode: any/u,
      /payload: any/u,
      /frames: any/u,
      /spectrum: any/u,
      /readonly \[x: string\]: any/u,
      /Ephemeral<any>/u,
    ],
  },
  {
    name: "observer example",
    marker: 'id: "examples/observer"',
    forbidden: [
      /enabled: any/u,
      /mode: any/u,
      /state: any/u,
      /drift: any/u,
      /readonly \[x: string\]: any/u,
    ],
  },
];

const files = await readdir(cacheDir);
const cacheEntries = await Promise.all(
  files
    .filter((file) => file.endsWith(".json"))
    .map(async (file) => {
      const path = join(cacheDir, file);
      const raw = await readFile(path, "utf8");
      return { file, parsed: JSON.parse(raw) };
    }),
);

const failures = [];

for (const { file, parsed } of cacheEntries) {
  if (parsed.queries?.length > 0) {
    failures.push(
      `${file}: contains ${String(parsed.queries.length)} persistent Twoslash query panel(s)`,
    );
  }

  for (const snippet of importantSnippets) {
    if (!parsed.code.includes(snippet.marker)) {
      continue;
    }

    const texts = [
      ...(parsed.nodes ?? []),
      ...(parsed.hovers ?? []),
      ...(parsed.queries ?? []),
    ].map((node) => node.text ?? "");

    for (const pattern of snippet.forbidden) {
      const match = texts.find((text) => pattern.test(text));

      if (match) {
        failures.push(
          `${file}: ${snippet.name} Twoslash output still matches ${pattern.toString()}: ${match}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exitCode = 1;
}
