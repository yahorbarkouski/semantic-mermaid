---
name: semantic-mermaid
description: "Write flowcharts that lay out well. Use when drawing or editing a Mermaid flowchart (process, workflow, decision tree, pipeline, architecture) for docs, READMEs, pull requests or chat: add Semantic Mermaid directives that state what the diagram means."
license: MIT
compatibility: Checking and rendering use the semantic-mermaid CLI from npm, which needs Node 22.12 or later.
---

# Semantic Mermaid

Semantic Mermaid is Mermaid flowchart syntax plus comment lines that say what the diagram means. A layout engine reads them: the main path is drawn as one line wherever it can be, exits sit beside their decision, retries are drawn as returns, side boxes sit beside the step they serve, and parties become swimlanes. The lines are `%%` comments, so the diagram still renders anywhere Mermaid does, and a wrong directive cannot break it.

You know what the diagram means when you write it. State all of it, and the engine does the geometry. Never position boxes yourself or adjust the layout by trial and error.

## Workflow

1. Write the flowchart as usual, with a short id for every box (`A`, `pay`, `B2`).
2. Add every directive that applies (below): the main path, each exit and retry, every box or group that serves one step, peers in order, lanes. Each fact you state is one the engine does not have to guess, so state everything that is true of the diagram.
3. If you have the `semantic-mermaid` CLI, check once. Pass the diagram on standard input with `-`, so no file is written:

   ```
   semantic-mermaid check - <<'MMD'
   flowchart TD
     A([Order placed]) --> B{Payment ok?}
     %% … the rest of the diagram, then its directives
   MMD
   ```

   It prints `stdin: ok`, or each problem with what fixes it, such as the valid ids or where an arrow really leads. Fix those lines. When you will render in step 4, skip this step: `render` prints the same check. Without the CLI, skip it too.
4. Deliver it in the form the reader's tool can show. `render` reads the diagram from standard input too, writes only the image named by `-o` (creating its folder), and writes nothing while the diagram has errors. Never save the Mermaid source to a file of its own: every SVG that `render` writes carries the diagram's text.
   - A page or app that says it draws Semantic Mermaid: the Mermaid text is enough.
   - A file in a repository that GitHub or GitLab shows, such as a README or a doc: those hosts ignore the directives. Render an SVG into the repository, with the diagram between the `<<'MMD'` line and a closing `MMD` line as in step 3, and embed it as an image:

     ```
     semantic-mermaid render - -o docs/diagrams/order.svg <<'MMD'
     ```

     `![Order flow](docs/diagrams/order.svg)`. To change the diagram later, `semantic-mermaid source docs/diagrams/order.svg` prints the text it was drawn from; edit that text and render it to the same file.
   - A place that takes only text, such as a pull-request or issue description, a comment, or a Notion page: put the diagram in a `mermaid` code block. The host draws it with its own layout, and the directives stay in it for anyone who renders it later.
   - A chat or a terminal: the diagram is temporary, so render it to a temporary file, `semantic-mermaid render - -o "$(mktemp -d)/order.png" <<'MMD'`, and share the PNG at the path `render` prints. Include the Mermaid text in your reply if the user may want to change it.

   `render` draws for a page about 800 px wide, such as a README or a chat: it centres a narrower diagram, and lays out the other way one the page would shrink below 40% of its size, with a `note` saying so; keep that drawing. For an image shown much wider or narrower, pass `--page-width <px>`.

   There is no need to open the image yourself. If `render` says the browser is not installed, ask the user whether to run `semantic-mermaid setup`, which downloads about 95 MB once.

   In PowerShell, pipe a here-string instead of a heredoc, with `@'` ending its first line and `'@` starting its last, and write temporary files under `$env:TEMP`:

   ```
   @'
   flowchart TD
     A --> B
   '@ | semantic-mermaid check -
   ```

The CLI is the npm package `semantic-mermaid`. If the `semantic-mermaid` command is missing, ask the user whether to install it with `npm install -g semantic-mermaid`. If they decline, deliver the diagram in a `mermaid` code block.

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
- `@main`: boxes in order, with an arrow from each to the next, through each decision's normal outcome: the one the process expects, such as success, yes or valid. Where the path splits into peers, take one of them. A process diagram almost always has a main path.
- `@exit`: only outcomes that end the flow early. A normal alternative is not an exit.
- `@retry`: only arrows that go back to an earlier step.
- `@side`: only boxes with exactly one arrow, or a group whose boxes all link to one step outside it.
- `@lanes`: when work passes back and forth between parties (people, teams, services), put each party's steps in a top-level `subgraph` and name the subgraphs in order. Use `flowchart TD` for lanes as columns, `LR` for lanes as rows. Lanes hold boxes only, no nested subgraphs, and the diagram has no other subgraphs. Stages a process passes through once (data, training, serving) are not lanes: keep them as plain subgraphs.
- Keep labels on arrows to exit boxes and side boxes at 24 characters or fewer, and put at most two boxes beside one step; otherwise the box cannot sit beside its step. `check` warns about both.
- Wrap a label that contains punctuation such as `(`, `)`, `:` or `#` in double quotes, `A["Pay (card)"]`, and write a double quote inside a label as `#quot;`.
- A chain of more than about 15 steps reads better as `flowchart LR`, or split into several diagrams.
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

With `@exit B -> X` in the example changed to `@exit B -> Y`:

```
stdin: 1 error
error: line 12: @exit: no node "Y"; ids are A, B, C, D, E, F, G, X, R
```

- `error`: a directive the engine ignores, because it names a box or an arrow the diagram does not have, is misspelt, or is malformed. Fix the line as the message says. `render` writes no image while there are errors.
- `warning`: the directive does not fit the diagram, for example a side box with two arrows or a label too long for the box to sit beside its step. Fix it or delete the line.
- `note`, printed by `render` only: how the chosen layout differs from what you declared, for example peers out of order because keeping the order cost crossings. No action is needed.
- A Mermaid syntax error comes as `Mermaid could not parse the diagram`, with Mermaid's own message and line.
