# tessellio-demo

A demo of the **Tessellio** screen codec: a surface painted from an update, and
the bytes that update cost.

Tessellio paints a surface as tiles of cells and moves only the tiles that
changed. An **update** is either **self-contained** (it establishes the whole
surface) or **chained** (it continues exactly the surface the named base
established). A region's content is an op stream inside a raw-DEFLATE
envelope.

This repository is the shortest honest path from nothing to that working: a
sender that captures a screen and encodes it, a receiver that paints the
surface from the update, and the measurements of both.

## Running it

You need Node 20.11 or newer and a Rust toolchain (1.88 or newer).

```bash
git clone https://github.com/tessellio/tessellio-demo
cd tessellio-demo
npm install
npm start
```

Then open <http://localhost:8080>.

`npm start` builds the browser bundle and the sender, runs the sender once so
the page has an artifact to paint, and serves the page. The first build
compiles the codec; after that it takes a second.

## What it shows

The page has two panes and a table.

- **The sender's capture** — the surface the sender encoded.
- **The receiver's surface** — the surface the receiver painted from the
  update that capture produced.
- **The table** — what each update cost: its bytes against the budget, the
  cells it changed, the regions and parts it was split into, the time the
  encoder took and where that time went, and the time the receiver took to
  inflate and paint it.

Two updates are sent:

| update | kind | what it carries |
|---|---|---|
| 1 | self-contained | the whole capture: every cell of the surface |
| 2 | chained | the cells that changed since the first capture |

The receiver applies them with the published browser package, and the page
checks the painted surface against the capture: the last line of the report
says whether the two are identical.

## The budgets

Every number on the page is measured, and every measurement is printed next to
the budget it is held to.

| measurement | budget | where it comes from |
|---|---|---|
| the bytes of one update | `MAX_UPDATE_WIRE_BYTES` (3 932 160) | the codec's own limit |
| the parts of one update | `MAX_PARTS_PER_UPDATE` (8) | the codec's own limit |
| the regions of one update | `MAX_REGIONS_PER_UPDATE` (64) | the codec's own limit |
| the encode of one update | 100 ms | the demo's budget |
| the decode and paint of one update | 100 ms | the demo's budget |

The byte budgets are the codec's: the demo reads them from the package it
depends on, so it cannot quietly widen them. The timing budgets are the
demo's, and they are declared in `web/budgets.ts`.

## The headless run

The same paint, without a browser:

```bash
npm run headless
```

It runs the sender, applies the updates with the published package against a
canvas double, compares the painted surface with the capture, and holds every
measurement against its budget. It is the demo's gate, and it fails when a
budget is exceeded or when the painted surface differs from the capture.

```
the sender's updates
  update 1 (self-contained): bytes=659 budget=3932160 changed_cells=57600 regions=1 parts=1 encode=0.542ms budget=100ms
    phases: convert=0.095ms pack=0.439ms compress=0.086ms reference=0.006ms
  update 2 (chained): bytes=241 budget=3932160 changed_cells=1554 regions=3 parts=1 encode=0.292ms budget=100ms
    phases: convert=0.028ms compare=0.015ms spans=0.019ms pack=0.021ms compress=0.112ms reference=0.003ms
the receiver's paint
  update 1: 24.840ms budget=100ms
  update 2: 14.673ms budget=100ms
  applied=2 refused=0 cells=57600 differing=0
the painted surface matches the capture, and every measurement is inside its budget
```

The gate that checks all of it:

```bash
bash scripts/verify.sh
```

It type-checks the demo, builds the bundle and the sender, and runs the
headless run.

## The layout

| path | what it holds |
|---|---|
| `rust/src/main.rs` | the sender: it captures a screen, encodes it with the codec, splits the update into parts, checks its own surface, and writes the artifact |
| `web/paint.ts` | the receiver: it applies the parts with the published package and compares the painted surface with the capture |
| `web/app.ts` | the browser page |
| `web/canvas.ts` | the canvas and `ImageData` doubles the headless run needs |
| `web/budgets.ts` | the budgets, and where they come from |
| `scripts/verify.sh` | the gate |

## The revisions this demo pins

| what | repository | revision |
|---|---|---|
| the codec (the sender) | [`tessellio-core`](https://github.com/tessellio/tessellio-core) | `37c639095658717ca519b3e0955fe3f02f22da7b` |
| the codec (the browser) | [`tessellio-ts`](https://github.com/tessellio/tessellio-ts) | `995b7b8178cd5fc2ee557b5ee0449e759abeae37` |

The demo consumes both the way any consumer does: it depends on them at a
pinned revision and it carries no copy of either.

## The rest of the codec

| repository | what it holds |
|---|---|
| [`tessellio`](https://github.com/tessellio/tessellio) | the specification |
| [`tessellio-core`](https://github.com/tessellio/tessellio-core) | the Rust implementation, the source of truth for every number and every rule |
| [`tessellio-ts`](https://github.com/tessellio/tessellio-ts) | the browser implementation |
| [`tessellio-proto`](https://github.com/tessellio/tessellio-proto) | the wire schemas |
| [`tessellio-conformance`](https://github.com/tessellio/tessellio-conformance) | the conformance corpus and its gate |

## Licence

Apache-2.0. See [LICENSE](LICENSE).
