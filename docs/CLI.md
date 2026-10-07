# The semantic-mermaid command

`semantic-mermaid` checks a Semantic Mermaid diagram and renders it to SVG or PNG. Your agent runs it through the skill; this page is for running it yourself.

## Install

The CLI needs Node 22.12 or later:

```bash
npm install -g semantic-mermaid
```

```bash
semantic-mermaid setup
```

`check` runs Mermaid's parser in Node and works right after `npm install`, which takes about 220 MB, most of it Mermaid. `setup` downloads the headless browser that `render` draws in (about 95 MB, 200 MB unpacked), once. On Linux the browser also needs system libraries; if they are missing, `render`'s error message gives the command that installs them.

## Check, render, read back

[examples/order.mmd](../examples/order.mmd) is one of the examples in this repository:

```bash
semantic-mermaid check examples/order.mmd
```

```bash
semantic-mermaid render examples/order.mmd -o order.svg -o order.png
```

```bash
semantic-mermaid source order.svg
```

- `check` prints `ok`, or each problem with its line and what fixes it, and exits with status 1 when there is an error.
- `render` writes each `-o` file in the format its name ends in, `.svg` or `.png`, and `<file>.svg` beside the source when there is no `-o`. It creates the image's folder, and writes nothing while the diagram has errors.
- Every SVG `render` writes carries the diagram's text, which `source` prints, so a diagram can be changed later without a separate source file.
- A file argument of `-` reads the diagram from standard input, so a diagram another program writes never needs a file; `render -` then takes the image to write from `-o`.

`render` draws images for a page about 800 px wide, as [Auto-sized for the page](../README.md#auto-sized-for-the-page) describes.

## Options

| Option | Command | What it does |
| --- | --- | --- |
| `-o <file>` | `render` | The image to write, `.svg` or `.png`; repeat it to write both |
| `--page-width <px>` | `render` | The width of the page the image is for (default 800) |
| `--no-fit` | `render` | Keep the diagram as written, at its own width |
| `--elk` | `render` | Draw the same diagram with Mermaid's ELK layout, for comparison |
| `--no-colors` | `render` | Keep Mermaid's own colours |
| `--verbose`, `-v` | `check`, `render` | Also print what the engine understood, and for `render` the layout it chose |
| `--json` | `check`, `render` | Print the full report as JSON |
| `--version` | | Print the version |

## What it prints

With `@exit B -> X` in `examples/order.mmd` changed to `@exit B -> Y`:

```
order.mmd: 1 error
error: line 11: @exit: no node "Y"; ids are A, B, C, D, E, F, G, X, R
```

`check` also warns when the diagram's own configuration selects another layout (`config: layout: elk`), which would switch the directives off. `--verbose` adds what the engine understood:

```
order.mmd: ok
understood:
  main path (declared): A -> B -> C -> D -> E -> F
  exits (declared): B -> X
  retries, drawn as returns (declared): G -> D
  side branches of main-path decisions (inferred): D -> G
  side boxes: R (declared)
```

`render --verbose` also prints the layout the engine chose:

```
layout: semantic (score 0.18; plain ELK 1.13; lower is better)
  crossings 0, arrows through boxes 0, label clashes 0, hugging arrows 0, crossed group titles 0, aspect 0.72
```

The score is the engine's own measure, and it compares layouts of the same diagram only. The second line counts defects in the chosen layout: arrow crossings, arrows through boxes, labels touching other arrows, unrelated arrows running side by side ("hugging"), arrows across group titles, and the drawing's width-to-height ratio ("aspect"). When the chosen layout leaves out something you declared, for example a peer order that would have cost crossings, or turns the diagram to fit the page, `render` says so in a `note` line.
