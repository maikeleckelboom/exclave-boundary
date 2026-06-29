import { nextTick, watch } from "vue";
import { inBrowser, useData, useRoute } from "vitepress";

type MermaidModule = typeof import("mermaid");

let mermaidPromise: Promise<MermaidModule> | undefined;
let renderVersion = 0;
let renderQueue = Promise.resolve();

function loadMermaid() {
  mermaidPromise ??= import("mermaid");
  return mermaidPromise;
}

function themeVariables(isDark: boolean) {
  if (isDark) {
    return {
      background: "transparent",
      clusterBkg: "#171c1b",
      clusterBorder: "#2b3834",
      edgeLabelBackground: "#111514",
      lineColor: "#8aa09a",
      mainBkg: "#171c1b",
      nodeBorder: "#2dd4bf",
      primaryBorderColor: "#2dd4bf",
      primaryColor: "#1b2421",
      primaryTextColor: "#edf4f1",
      secondaryColor: "#22302c",
      tertiaryColor: "#111514",
    };
  }

  return {
    background: "transparent",
    clusterBkg: "#f8faf9",
    clusterBorder: "#d7dfdb",
    edgeLabelBackground: "#f8faf9",
    lineColor: "#60736e",
    mainBkg: "#edf5f2",
    nodeBorder: "#0f766e",
    primaryBorderColor: "#0f766e",
    primaryColor: "#edf5f2",
    primaryTextColor: "#14211f",
    secondaryColor: "#f8faf9",
    tertiaryColor: "#ffffff",
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Mermaid render timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function renderMermaid(isDark: boolean, currentVersion: number) {
  await nextTick();

  if (!inBrowser || currentVersion !== renderVersion) {
    return;
  }

  const { default: mermaid } = await loadMermaid();

  if (currentVersion !== renderVersion) {
    return;
  }

  mermaid.initialize({
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    securityLevel: "strict",
    startOnLoad: false,
    theme: "base",
    themeVariables: themeVariables(isDark),
  });

  const cards = Array.from(
    document.querySelectorAll<HTMLElement>("[data-mermaid]"),
  );

  for (const [index, card] of cards.entries()) {
    const source = card.querySelector<HTMLElement>(".mermaid-source");
    const target = card.querySelector<HTMLElement>(".mermaid-render");
    const graphDefinition = source?.textContent?.trim();

    if (!target || !graphDefinition) {
      continue;
    }

    const renderKey = `${isDark ? "dark" : "light"}:${graphDefinition}`;

    if (
      card.dataset.mermaidRendered === renderKey &&
      card.dataset.processed === "true"
    ) {
      continue;
    }

    delete card.dataset.mermaidRendered;
    card.dataset.processed = "pending";
    target.innerHTML = "";
    target.removeAttribute("data-processed");

    try {
      const id = `exclave-mermaid-${String(currentVersion)}-${String(index)}`;
      const { svg } = await withTimeout(
        mermaid.render(id, graphDefinition),
        8000,
      );

      if (currentVersion !== renderVersion) {
        return;
      }

      target.innerHTML = svg;
      target.setAttribute("aria-hidden", "false");
      card.dataset.mermaidRendered = renderKey;
      card.dataset.processed = "true";
    } catch (error) {
      target.textContent =
        error instanceof Error ? error.message : "Unable to render diagram.";
      target.setAttribute("aria-hidden", "false");
      card.dataset.processed = "error";
    }
  }
}

export function useMermaidRenderer() {
  if (!inBrowser) {
    return;
  }

  const route = useRoute();
  const { isDark } = useData();

  watch(
    [() => route.path, isDark],
    () => {
      const currentVersion = ++renderVersion;
      renderQueue = renderQueue
        .catch(() => undefined)
        .then(() => renderMermaid(isDark.value, currentVersion));
      void renderQueue;
    },
    { immediate: true },
  );
}
