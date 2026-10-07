import {
  __name
} from "./chunks/mermaid-layout-elk.esm/chunk-TWI3KLJS.mjs";

// ../mermaid/src/rendering-util/layout-algorithms/elk/algorithms.ts
var ELK_ALGORITHMS = [
  "elk.stress",
  "elk.force",
  "elk.mrtree",
  "elk.sporeOverlap",
  "elk.box",
  "elk.rectpacking"
];

// ../mermaid/src/rendering-util/layout-algorithms/elk/plugin.ts
var loader = /* @__PURE__ */ __name(async () => await import("./chunks/mermaid-layout-elk.esm/elk-KGXXK6EI.mjs"), "loader");
var layouts = [
  { name: "elk", loader, algorithm: "elk.layered" },
  ...ELK_ALGORITHMS.map((algorithm) => ({ name: algorithm, loader, algorithm }))
];
var plugin_default = layouts;
export {
  plugin_default as default
};
