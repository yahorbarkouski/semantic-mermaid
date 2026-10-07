// Plain-text reports for people and agents, printed by the CLI.

/** @typedef {import('../src/mermaid/loader.js').Report} Report */

/**
 * Plain-text summary of a report. By default only what needs action: problems with directives
 * (errors and warnings, with line numbers) and notes about declared facts the layout left out.
 * `verbose` adds what the engine understood and the chosen layout's measurements.
 * @param {Report | null} report
 * @param {{ verbose?: boolean }} [options]
 * @returns {string} empty when there is nothing to report
 */
export function formatReport(report, { verbose = false } = {}) {
  if (!report) return verbose ? 'layout: Mermaid ELK (no semantic report)' : '';
  const lines = [];
  if (verbose) {
    lines.push('understood:', ...report.understood.map((l) => `  ${l}`));
    if (report.layout) {
      const m = report.layout.measurements, base = report.layout.tried.find((t) => t.name === 'elk');
      const chosen = report.layout.tried.find((t) => t.name === report.layout?.chosen);
      lines.push(`layout: ${report.layout.chosen} (score ${chosen?.score}; plain ELK ${base?.score}; lower is better)`);
      lines.push(`  crossings ${m.crossings}, arrows through boxes ${m.throughBoxes}, label clashes ${m.labelClashes}, hugging arrows ${m.hugging}, crossed group titles ${m.titleCrossings}, aspect ${m.aspect.toFixed(2)}`);
    }
  }
  // problems in the order of their lines, so they read top to bottom against the source
  const problems = report.diagnostics.filter((d) => d.severity !== 'info').sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  for (const d of problems) lines.push(`${d.severity}: ${d.line ? `line ${d.line}: ` : ''}${d.message}`);
  for (const d of report.diagnostics) if (d.severity === 'info') lines.push(`note: ${d.message}`);
  return lines.join('\n');
}

/**
 * One status line, "ok" or "2 errors", then the report.
 * @param {Report | null} report
 * @param {{ verbose?: boolean, name?: string }} [options]
 */
export function formatStatus(report, { verbose = false, name } = {}) {
  const errors = report?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const status = errors ? `${errors} error${errors > 1 ? 's' : ''}` : 'ok';
  return [name ? `${name}: ${status}` : status, formatReport(report, { verbose })].filter(Boolean).join('\n');
}
