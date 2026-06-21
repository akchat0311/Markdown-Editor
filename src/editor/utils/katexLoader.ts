type KatexAPI = typeof import("katex").default;

let api: KatexAPI | null = null;
let promise: Promise<KatexAPI> | null = null;

export function ensureKatex(): Promise<KatexAPI> {
  if (api) return Promise.resolve(api);
  if (!promise) {
    promise = import("katex").then((m) => {
      api = m.default;
      return api;
    });
  }
  return promise;
}

export function getKatex(): KatexAPI | null {
  return api;
}

export function katexRenderToString(src: string, displayMode: boolean): string {
  if (!api) return src;
  try {
    return api.renderToString(src, { throwOnError: false, displayMode, output: "htmlAndMathml" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `<span class="math-error-inline">${msg}</span>`;
  }
}
