// Facts: what the engine knows about a diagram's meaning. Declared directives come first; whatever
// the author did not declare is inferred from the graph's structure, so plain Mermaid works too.
import { adjacency, boxes } from '../model/graph.js';

/** Longest arrow label a box beside its step, or an exit beside its decision, may carry; a longer one would push the box far away. */
export const SIDE_LABEL = 24;
/** Most boxes beside one step, or the step disappears among them. */
export const MOST_BESIDE = 2;

/** @typedef {import('../model/graph.js').Graph} Graph */
/** @typedef {import('../model/graph.js').GraphEdge} GraphEdge */
/** @typedef {import('../language/directives.js').Annotations} Annotations */
/** @typedef {import('../language/directives.js').Diagnostic} Diagnostic */

/** @typedef {'main' | 'exit' | 'retry' | 'side' | 'branch'} EdgeRole */
/** @typedef {'entry' | 'end' | 'decision' | 'exit' | 'side'} NodeRole */
/** @typedef {'declared' | 'inferred'} Source */

/**
 * @typedef {object} SideGroup  a group whose boxes all serve one step outside it
 * @property {string} step       the step they serve
 * @property {string[]} members  the group's boxes
 * @property {string[]} links    the arrows between the members and the step
 * @property {'in' | 'out'} toward  'in' when the members feed the step, 'out' when the step feeds them
 * @property {Source} source
 */

/**
 * @typedef {object} Facts
 * @property {string[]} mainPath             edge ids along the main path, in order
 * @property {Source | null} mainSource
 * @property {Map<string, EdgeRole>} edgeRoles  edges without a role are ordinary
 * @property {Map<string, NodeRole>} nodeRoles
 * @property {Map<string, string>} continuation  decision id -> the edge that continues the main path
 * @property {Set<string>} loops              arrows to lay out as returns (declared retries)
 * @property {Map<string, Source>} sideBoxes  boxes that sit beside the step they serve
 * @property {Map<string, SideGroup>} sideGroups  groups that sit beside the step they serve, by group id
 * @property {string[][]} peers               boxes in declared side-by-side order
 * @property {string[]} lanes                 groups drawn as swimlanes, in order (empty: none)
 * @property {Set<string>} declaredEdges      edges whose role the author declared
 * @property {boolean} colors
 */

export const DECISION_SHAPES = new Set(['diamond', 'question', 'decision']);
const ENDPOINT_SHAPES = new Set(['stadium', 'circle', 'doublecircle', 'rounded', 'terminal', 'start', 'stop', 'sm-circ', 'fr-circ']);

/**
 * Bind declared annotations to the graph, then infer what is missing.
 * @param {Graph} graph
 * @param {Annotations} annotations
 * @returns {{ facts: Facts, diagnostics: Diagnostic[] }}
 */
export function resolveFacts(graph, annotations) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const { out, into } = adjacency(graph);
  const known = (id, where, line) => {
    if (graph.nodes.has(id)) return true;
    diagnostics.push({ severity: 'error', line, message: `${where}: no node "${id}"${suggest(graph, id)}` });
    return false;
  };
  const arrowsBetween = (from, to) => graph.edges.filter((e) => e.from === from && e.to === to);
  // where a box's arrows do go, so a wrong arrow can be fixed without reading the diagram again
  const leadsTo = (/** @type {string} */ from) => {
    const targets = [...new Set((out.get(from) ?? []).map((e) => e.to))];
    return targets.length ? `; ${from} leads to ${targets.join(', ')}` : `; ${from} has no outgoing arrows`;
  };

  /** @type {Facts} */
  const facts = {
    mainPath: [], mainSource: null, edgeRoles: new Map(), nodeRoles: new Map(), continuation: new Map(),
    loops: new Set(), sideBoxes: new Map(), sideGroups: new Map(), peers: [], lanes: [], declaredEdges: new Set(), colors: annotations.colors,
  };

  // declared arrows: exits and retries
  for (const [list, role] of /** @type {const} */ ([[annotations.exits, 'exit'], [annotations.retries, 'retry']])) {
    for (const { from, to, line } of list) {
      if (!known(from, `@${role}`, line) || !known(to, `@${role}`, line)) continue;
      const found = arrowsBetween(from, to);
      if (!found.length) { diagnostics.push({ severity: 'error', line, message: `@${role} ${from} -> ${to}: the diagram has no such arrow${leadsTo(from)}` }); continue; }
      for (const e of found) {
        facts.edgeRoles.set(e.id, role);
        facts.declaredEdges.add(e.id);
        if (role === 'retry') facts.loops.add(e.id);
      }
      // an exit box with no other arrows sits beside its decision, which leaves room for a short label only
      const ends = (out.get(to)?.length ?? 0) + (into.get(to)?.length ?? 0) === 1;
      const long = found.find((e) => e.label.length > SIDE_LABEL);
      if (role === 'exit' && ends && long) diagnostics.push({ severity: 'warning', line, message: `@exit ${from} -> ${to}: the arrow's label has ${long.label.length} characters, and ${to} sits beside ${from} only when it has at most ${SIDE_LABEL}; shorten the label` });
    }
  }

  // declared side groups: a group named by id, or every box of a group listed
  const declaredSide = new Map(annotations.sides.flatMap(({ ids, line }) => ids.map((id) => [id, line])));
  for (const [id, line] of declaredSide) {
    if (!known(id, '@side', line)) continue;
    const node = graph.nodes.get(id);
    const groupId = node?.isGroup ? id : node?.parent;
    if (!groupId || facts.sideGroups.has(groupId)) continue;
    const members = membersOf(graph, groupId);
    if (!node?.isGroup && !members.every((m) => declaredSide.has(m))) continue;
    const found = sideGroupOf(graph, groupId, out, into);
    if (typeof found === 'string') {
      if (node?.isGroup) diagnostics.push({ severity: 'warning', line, message: `@side ${id}: ${found}; the group is laid out normally` });
      continue;
    }
    if (graph.nodes.get(found.step)?.parent !== graph.nodes.get(groupId)?.parent) {
      diagnostics.push({ severity: 'warning', line, message: `@side ${id}: ${found.step} is inside another group, so ${groupId} cannot sit beside it; the group is laid out normally` });
      continue;
    }
    facts.sideGroups.set(groupId, { ...found, source: 'declared' });
  }

  // declared side boxes outside those groups
  /** @type {Map<string, number>} */
  const besideStep = new Map();
  for (const [id, line] of declaredSide) {
    const node = graph.nodes.get(id);
    if (!node || node.isGroup || (node.parent && facts.sideGroups.has(node.parent))) continue;
    const links = [...(out.get(id) ?? []), ...(into.get(id) ?? [])];
    const partner = links.length === 1 ? (links[0].from === id ? links[0].to : links[0].from) : null;
    if (links.length !== 1) diagnostics.push({ severity: 'warning', line, message: `@side ${id}: a side box serves one step, but ${id} has ${links.length} arrows; it is laid out as a normal box` });
    else if (node.parent && partner && graph.nodes.get(partner)?.parent !== node.parent) diagnostics.push({ severity: 'warning', line, message: `@side ${id}: ${id} is inside group "${node.parent}" and its step ${partner} is not; declare @side ${node.parent} to place the whole group beside ${partner}` });
    else {
      facts.sideBoxes.set(id, 'declared');
      const label = links[0].label;
      if (label.length > SIDE_LABEL) diagnostics.push({ severity: 'warning', line, message: `@side ${id}: the label on its arrow has ${label.length} characters, and a box sits beside its step only when it has at most ${SIDE_LABEL}; shorten the label` });
      const beside = (besideStep.get(/** @type {string} */ (partner)) ?? 0) + 1;
      besideStep.set(/** @type {string} */ (partner), beside);
      if (beside > MOST_BESIDE) diagnostics.push({ severity: 'warning', line, message: `@side ${id}: ${partner} already has ${MOST_BESIDE} boxes beside it, the most that fit, so ${id} is laid out as a normal box` });
    }
  }

  // inferred side groups: a set of references, every box of which links only to one step outside
  // the group, with no arrows inside the group (a group with its own flow is a stage, not a set of
  // references), two boxes or more, and the step beside it in the same parent
  for (const n of graph.nodes.values()) {
    if (!n.isGroup || facts.sideGroups.has(n.id)) continue;
    const found = sideGroupOf(graph, n.id, out, into);
    if (typeof found === 'string' || found.members.length < 2 || found.links.length !== found.members.length) continue;
    if (graph.nodes.get(found.step)?.parent !== n.parent) continue;
    facts.sideGroups.set(n.id, { ...found, source: 'inferred' });
  }

  // declared peers
  for (const { ids, line } of annotations.peers) {
    const found = ids.filter((id) => known(id, '@peers', line));
    if (found.length >= 2) facts.peers.push(found);
  }

  // declared lanes: top-level groups of plain boxes, the only groups in the diagram, with arrows
  // between their boxes only
  if (annotations.lanes) {
    const { ids, line } = annotations.lanes;
    const groups = ids.filter((id) => known(id, '@lanes', line));
    const lanes = new Set(groups);
    const others = [...graph.nodes.values()].filter((n) => n.isGroup && !lanes.has(n.id)).map((n) => n.id);
    const problem = groups.map((id) => {
      const n = graph.nodes.get(id);
      if (!n?.isGroup) return `${id} is a box, not a group`;
      if (n.parent) return `${id} is inside group ${n.parent}; lanes must be top-level groups`;
      if (membersOf(graph, id).some((m) => graph.nodes.get(m)?.isGroup)) return `${id} contains groups`;
      if ([...(out.get(id) ?? []), ...(into.get(id) ?? [])].length) return `arrows connect to the lane ${id} itself`;
      return null;
    }).find(Boolean) ?? (others.length ? `the diagram has other groups (${others.join(', ')}); lanes must be its only groups` : null);
    if (problem) diagnostics.push({ severity: 'warning', line, message: `@lanes: ${problem}; the groups are laid out normally` });
    else if (groups.length >= 2) facts.lanes = groups;
  }

  // main path: declared, or the heaviest path from an entry
  if (annotations.main) {
    const { line } = annotations.main;
    const ids = annotations.main.ids.filter((id) => known(id, '@main', line));
    const path = [];
    for (let k = 0; k + 1 < ids.length; k++) {
      const found = arrowsBetween(ids[k], ids[k + 1]);
      if (!found.length) diagnostics.push({ severity: 'error', line, message: `@main ${ids[k]} ${ids[k + 1]}: the diagram has no arrow ${ids[k]} --> ${ids[k + 1]}${leadsTo(ids[k])}` });
      else path.push(found[0].id);
    }
    if (path.length) { facts.mainPath = path; facts.mainSource = 'declared'; for (const id of path) facts.declaredEdges.add(id); }
    // `@main none`: the author says there is no main path, so none is inferred
    if (!annotations.main.ids.length) facts.mainSource = 'declared';
  }
  if (!facts.mainPath.length && facts.mainSource !== 'declared') {
    facts.mainPath = heaviestPath(graph, facts);
    facts.mainSource = facts.mainPath.length ? 'inferred' : null;
  }
  for (const id of facts.mainPath) if (!facts.edgeRoles.has(id)) facts.edgeRoles.set(id, 'main');

  // structural inference for the rest
  inferSideBoxes(graph, facts, out, into);
  for (const group of facts.sideGroups.values()) for (const m of group.members) if (!facts.nodeRoles.has(m)) facts.nodeRoles.set(m, 'side');
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  const onMain = new Set(facts.mainPath.flatMap((id) => [edgeById.get(id)?.from, edgeById.get(id)?.to]));
  for (const n of boxes(graph)) {
    if (!DECISION_SHAPES.has(n.shape)) continue;
    facts.nodeRoles.set(n.id, 'decision');
    const cont = (out.get(n.id) ?? []).find((e) => facts.mainPath.includes(e.id));
    if (!cont) continue;
    facts.continuation.set(n.id, cont.id);
    // the decision's other outcomes branch off the main path
    for (const e of out.get(n.id) ?? []) if (e !== cont && !facts.edgeRoles.has(e.id)) facts.edgeRoles.set(e.id, 'branch');
  }
  for (const [id] of facts.sideBoxes) facts.nodeRoles.set(id, 'side');
  for (const [edgeId, role] of facts.edgeRoles) {
    const e = edgeById.get(edgeId);
    // a declared exit that ends there is an exit box
    if (role === 'exit' && e && !(out.get(e.to) ?? []).length && !onMain.has(e.to)) facts.nodeRoles.set(e.to, 'exit');
  }
  // the ends of the main path are its entry and its end; an inferred path names them only when
  // their shape says so, because several parallel sources would otherwise be told apart by chance
  const first = edgeById.get(facts.mainPath[0]), last = edgeById.get(facts.mainPath[facts.mainPath.length - 1]);
  const named = (id) => facts.mainSource === 'declared' || ENDPOINT_SHAPES.has(graph.nodes.get(id)?.shape ?? '');
  if (first && named(first.from) && !(into.get(first.from) ?? []).some((e) => !facts.loops.has(e.id))) facts.nodeRoles.set(first.from, 'entry');
  if (last && named(last.to) && !(out.get(last.to) ?? []).some((e) => !facts.loops.has(e.id))) facts.nodeRoles.set(last.to, 'end');

  return { facts, diagnostics };
}

/**
 * The main path when none is declared: the heaviest path from an entry through arrows that are not
 * declared retries, counting a solid arrow 1 and a dotted one 0.3, and avoiding exits and side
 * boxes. Ties go to source order. Arrows that close a cycle (depth first, in source order) are
 * skipped, so the search runs on a DAG.
 * @param {Graph} graph
 * @param {Facts} facts
 * @returns {string[]}
 */
function heaviestPath(graph, facts) {
  const ids = boxes(graph).map((n) => n.id);
  const usable = graph.edges.filter((e) => e.from !== e.to && !facts.loops.has(e.id)
    && !graph.nodes.get(e.from)?.isGroup && !graph.nodes.get(e.to)?.isGroup);
  const aside = new Set([...facts.sideBoxes.keys(), ...[...facts.sideGroups.values()].flatMap((g) => g.members)]);
  const weight = (e) => facts.edgeRoles.get(e.id) === 'exit' || aside.has(e.to) || aside.has(e.from) ? 0.1 : e.dotted ? 0.3 : 1;
  /** @type {Map<string, GraphEdge[]>} */
  const out = new Map(ids.map((id) => [id, []]));
  for (const e of usable) out.get(e.from)?.push(e);
  const hasInput = new Set(usable.map((e) => e.to));
  const roots = [...ids.filter((id) => !hasInput.has(id) && ENDPOINT_SHAPES.has(graph.nodes.get(id)?.shape ?? '')), ...ids.filter((id) => !hasInput.has(id)), ...ids];

  /** @type {Map<string, GraphEdge[]>} */
  const dag = new Map();
  const state = new Map();
  const visit = (u) => {
    state.set(u, 1);
    const kept = [];
    for (const e of out.get(u) ?? []) {
      if (state.get(e.to) === 1) continue; // closes a cycle
      kept.push(e);
      if (!state.has(e.to)) visit(e.to);
    }
    dag.set(u, kept);
    state.set(u, 2);
  };
  for (const r of roots) if (!state.has(r)) visit(r);

  /** @type {Map<string, { w: number, path: string[] }>} */
  const best = new Map();
  const go = (u) => {
    const known = best.get(u);
    if (known) return known;
    let b = { w: 0, path: /** @type {string[]} */ ([]) };
    for (const e of dag.get(u) ?? []) {
      const r = go(e.to), w = weight(e) + r.w;
      if (w > b.w + 1e-9) b = { w, path: [e.id, ...r.path] };
    }
    best.set(u, b);
    return b;
  };
  let top = { w: 0, path: /** @type {string[]} */ ([]) };
  for (const r of new Set(roots)) { const b = go(r); if (b.w > top.w + 1e-9) top = b; }
  return top.path.length >= 2 ? top.path : [];
}

/**
 * A box with a single dotted link to a step that has other arrows is a side box (a store, a
 * config, a log) unless the author said otherwise. Solid single links stay ordinary: an outcome at
 * the end of a branch also has one link, and structure alone cannot tell the two apart.
 */
function inferSideBoxes(graph, facts, out, into) {
  for (const n of boxes(graph)) {
    if (facts.sideBoxes.has(n.id)) continue;
    const links = [...(out.get(n.id) ?? []), ...(into.get(n.id) ?? [])];
    if (links.length !== 1 || !links[0].dotted || facts.declaredEdges.has(links[0].id)) continue;
    const partner = links[0].from === n.id ? links[0].to : links[0].from;
    const partnerLinks = (out.get(partner)?.length ?? 0) + (into.get(partner)?.length ?? 0);
    if (partnerLinks >= 3) facts.sideBoxes.set(n.id, 'inferred');
  }
}

/** @param {Graph} graph @param {string} groupId */
function membersOf(graph, groupId) {
  return [...graph.nodes.values()].filter((n) => n.parent === groupId).map((n) => n.id);
}

/**
 * The step a group serves, or why it serves none: every arrow between the group and the rest of the
 * diagram must join one of its boxes to the same step outside it, all in the same direction.
 * @returns {Omit<SideGroup, 'source'> | string}
 */
function sideGroupOf(graph, groupId, out, into) {
  const members = membersOf(graph, groupId);
  if (!members.length) return 'the group is empty';
  if (members.some((m) => graph.nodes.get(m)?.isGroup)) return 'the group contains groups';
  const inside = new Set(members);
  if ([...(out.get(groupId) ?? []), ...(into.get(groupId) ?? [])].length) return 'arrows connect to the group itself';
  const links = members.flatMap((m) => [...(out.get(m) ?? []), ...(into.get(m) ?? [])]).filter((e) => !(inside.has(e.from) && inside.has(e.to)));
  if (!links.length) return 'no arrow connects the group to a step';
  const steps = new Set(links.map((e) => (inside.has(e.from) ? e.to : e.from)));
  if (steps.size !== 1) return `its arrows reach ${steps.size} different boxes (${[...steps].join(', ')}), not one step`;
  const step = [...steps][0];
  if (graph.nodes.get(step)?.isGroup) return 'its arrows reach a group, not a step';
  const toward = new Set(links.map((e) => (inside.has(e.from) ? 'in' : 'out')));
  if (toward.size !== 1) return `arrows run both ways between the group and ${step}`;
  return { step, members, links: [...new Set(links.map((e) => e.id))], toward: /** @type {'in' | 'out'} */ ([...toward][0]) };
}

/**
 * " (did you mean X?)" when an id was written as a label or with different case; otherwise the ids
 * the diagram has, so the directive can be fixed without reading the diagram again.
 */
function suggest(graph, id) {
  const lower = id.toLowerCase();
  for (const n of graph.nodes.values()) {
    if (n.id.toLowerCase() === lower || n.label.toLowerCase() === lower) return ` (did you mean "${n.id}"?)`;
  }
  const ids = [...graph.nodes.keys()];
  return `; ids are ${ids.slice(0, 40).join(', ')}${ids.length > 40 ? ', …' : ''}`;
}

/**
 * What the engine understood, in short lines an agent or a person can check.
 * @param {Graph} graph
 * @param {Facts} facts
 * @returns {string[]}
 */
export function describeFacts(graph, facts) {
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  const arrow = (id) => { const e = edgeById.get(id); return e ? `${e.from} -> ${e.to}` : id; };
  const lines = [];
  if (facts.mainPath.length) {
    const nodes = [edgeById.get(facts.mainPath[0])?.from, ...facts.mainPath.map((id) => edgeById.get(id)?.to)];
    lines.push(`main path (${facts.mainSource}): ${nodes.join(' -> ')}`);
  } else lines.push(facts.mainSource === 'declared' ? 'main path: none (declared)' : 'main path: none found');
  const byRole = (role) => [...facts.edgeRoles].filter(([, r]) => r === role).map(([id]) => arrow(id));
  const exits = byRole('exit'), retries = byRole('retry'), branches = byRole('branch');
  if (exits.length) lines.push(`exits (declared): ${exits.join(', ')}`);
  if (retries.length) lines.push(`retries, drawn as returns (declared): ${retries.join(', ')}`);
  if (branches.length) lines.push(`side branches of main-path decisions (inferred): ${branches.join(', ')}`);
  if (facts.sideBoxes.size) lines.push(`side boxes: ${[...facts.sideBoxes].map(([id, s]) => `${id} (${s})`).join(', ')}`);
  for (const [id, g] of facts.sideGroups) lines.push(`side group: ${id} ${g.toward === 'in' ? 'feeds' : 'is fed by'} ${g.step} (${g.source})`);
  for (const p of facts.peers) lines.push(`peers, in order (declared): ${p.join(', ')}`);
  if (facts.lanes.length) lines.push(`lanes, in order (declared): ${facts.lanes.join(', ')}`);
  return lines;
}
