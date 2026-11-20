# Instructions for AI agents (Claude, Gemini/Antigravity, Codex, Cursor, Copilot, ...)

## MANDATORY: keep the knowledge graph up to date with graphify

This repo has a knowledge graph in [`graphify-out/`](graphify-out/) built with **graphify**
(PyPI package `graphifyy`, CLI `graphify`, https://github.com/safishamsi/graphify).

**Do not read the whole repo to understand it. Use the graph. And after EVERY change you make, update the graph.**
Stale graphs mislead the next agent, so this is not optional.

### 1. Install graphify (do this first, if `graphify --help` fails)

You MUST install it. Do not skip this step and do not fall back to "just reading files".

```bash
pip install "graphifyy[sql]"        # or: uv tool install "graphifyy[sql]"  /  pipx install "graphifyy[sql]"
graphify install --platform claude  # register the skill; use your own platform: codex | gemini | antigravity | cursor | copilot | opencode | aider | agents ...
graphify --help                     # verify
```

Note the double "y": the package is `graphifyy`. Other `graphify*` packages on PyPI are unrelated.
Python 3.10+ required. Code is parsed with AST (no API key, no LLM tokens needed).

### 2. Before working: read the graph, not the code

1. Read `graphify-out/GRAPH_REPORT.md` (god nodes, communities, surprising links, suggested questions).
2. Navigate with the CLI instead of grepping around:
   ```bash
   graphify query "how does opening a chest work?"   # BFS over the graph
   graphify explain "<node name>"                    # node + neighbours
   graphify path "<A>" "<B>"                         # shortest path between two concepts
   ```
3. Open only the specific files the graph points to (`source_file`, `source_location`).
4. `graphify-out/graph.html` is an interactive view; `graphify-out/graph.json` is the raw data.

### 3. After EVERY change: update the graph, then commit it together with your change

```bash
graphify update .        # re-extracts only changed code files (AST, free, no LLM, seconds)
```

- Run it after each code/doc change, before your commit, and commit the refreshed `graphify-out/`
  (`graph.json`, `GRAPH_REPORT.md`, `graph.html`, `manifest.json`) in the same commit.
- If you added or changed docs/markdown/images (semantic content), run the full skill instead
  (`/graphify . --update` in Claude Code, or the equivalent skill in your agent), because `graphify update .` only handles code.
- If you deleted files and the graph refuses to shrink: `/graphify . --force`.
- Optional but recommended: `graphify hook install` adds a git post-commit hook that rebuilds the code part automatically.
- Never hand-edit `graph.json`. Never commit `graphify-out/cache/` or `graphify-out/.graphify_*` temp files (they are gitignored).

### 4. Rules of thumb

- Graph first, files second. A grep is fine for one exact symbol; for "how does X work / what depends on Y" use `graphify query`.
- If `graphify-out/` is missing or clearly outdated (`graphify-out/manifest.json` older than recent commits), rebuild: `/graphify . --mode deep`.
- Images (`seed/`, `static/`) and audio/video were deliberately NOT semantically extracted (cost, low value); code, docs and configs were.
