---
name: semantic-mermaid
description: Write flowcharts that lay out well. Use when drawing or editing a Mermaid flowchart (process, workflow, decision tree, pipeline, architecture) for docs, READMEs, pull requests or chat: add Semantic Mermaid directives that state what the diagram means.
---

# Semantic Mermaid

Semantic Mermaid is Mermaid flowchart syntax plus comment lines that say what the diagram means. A layout engine reads them: the main path becomes one straight line, exits sit beside their decision, retries are drawn as returns, side boxes sit beside the step they serve, and parties become swimlanes. The lines are `%%` comments, so the diagram still renders anywhere Mermaid does, and a wrong directive cannot break it.

You know what the diagram means when you write it. State all of it, and the engine does the geometry. Never position boxes yourself or adjust the layout by trial and error.

## Workflow

1. Write the flowchart as usual, with a short id for every box (`A`, `pay`, `B2`).
2. Add every directive that applies (below): the main path, each exit and retry, every box or group that serves one step, peers in order, lanes. Each fact you state is one the engine does not have to guess, so state everything that is true of the diagram.
3. If you have the `semantic-mermaid` CLI, check once: `semantic-mermaid check diagram.mmd`. It prints `ok`, or each problem with what fixes it, such as the valid ids or where an arrow really leads. Fix those lines. When you will render in step 4, skip this step: `render` prints the same check. Without the CLI, skip it too.
4. Deliver it in the form the reader's tool can show:
   - A page that runs Semantic Mermaid: the Mermaid text is enough.
   - GitHub, GitLab, Notion, or other Markdown that draws Mermaid itself: those hosts ignore the directives. Save the source as a `.mmd` file, run `semantic-mermaid render name.mmd` (it writes `name.svg` beside the source), and embed the SVG as an image, for example `![Order flow](docs/diagrams/order.svg)`. Keep the `.mmd` file; when the diagram changes, edit it and render again.
   - A chat or a terminal: run `semantic-mermaid render name.mmd -o name.png` and share the PNG, with the Mermaid source if the user may want to change it.

   There is no need to open the image yourself. If `render` says the browser is not installed, run `semantic-mermaid setup` once.

## Directives

```
%% @main A B C D        the main path, start to end, through each decision's normal outcome
%% @main none           the diagram has no main path (a tree, a dependency graph)
%% @exit B -> X         an outcome that ends or abandons the flow (error, rejection, early exit)
%% @retry G -> D        an arrow back to an earlier step (retry, loop, recovery)
%% @side Config Logs    boxes that serve one step (configuration, store, log, notification)
%% @side Refs           a group of such boxes, by the group's id
%% @peers P0 P1 P2      boxes that belong side by side, in this order
%% @lanes User App IdP  groups that are parties handing work back and forth, as swimlanes in this order
%% @colors off          keep Mermaid's default colours
```

- Name boxes by id, never by label. Write arrows as `From -> To`; separate several with commas.
- `@main`: only boxes joined by arrows, in order. A process diagram almost always has one.
- `@exit`: only outcomes that end the flow early. A normal alternative is not an exit.
- `@retry`: only arrows that go back to an earlier step.
- `@side`: only boxes with exactly one arrow, or a group whose boxes all link to one step outside it.
- `@lanes`: when work passes back and forth between parties (people, teams, services), put each party's steps in a top-level `subgraph` and name the subgraphs in order. Use `flowchart TD` for lanes as columns, `LR` for lanes as rows. Lanes hold boxes only, no nested subgraphs. Stages a process passes through once (data, training, serving) are not lanes: keep them as plain subgraphs.
- Keep labels on exit arrows short (24 characters or fewer) so the exit can sit beside its decision.
- Put directives after the `flowchart` line, for example at the end. Frontmatter (`---`) must stay first.

## Example

```
flowchart TD
  A([Order placed]) --> B{Payment ok?}
  B -->|yes| C[Reserve stock]
  C --> D{In stock?}
  D -->|yes| E[Ship] --> F([Done])
  D -->|no| G[Backorder]
  G --> D
  B -->|no| X[Notify customer]
  R[(Fraud rules)] -.-> B

  %% @main A B C D E F
  %% @exit B -> X
  %% @retry G -> D
  %% @side R
```

## What check reports

```
order.mmd: 1 error
error: line 11: @exit: no node "Y"; ids are A, B, C, D, E, F, G, X, R
```

- `error`: the directive names a box or an arrow the diagram does not have, and the engine ignores it. Fix the line with the ids the message gives.
- `warning`: the directive does not fit the diagram, for example a side box with two arrows. Fix it or delete the line.
- `note`: the engine left a declared fact out of the layout because a layout without it scored better. No action is needed.
