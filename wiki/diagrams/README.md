# Diagrams

Visual-only collection (the **presentation** tier). Living diagrams are **Mermaid in Markdown** — version-controlled, no screenshots. Excalidraw PNGs are for hero diagrams only and live in [`png/`](png/).

> Stub. Drop diagram pages here as they're made.

## Diagram standard

Every flowchart starts with this themed header and applies classes via `:::class`:

```
%%{init: {'theme':'base','themeVariables':{'fontFamily':'Iosevka Nerd Font Mono, monospace','lineColor':'#555'}}}%%
flowchart TD
  classDef guard   fill:#FFF4CC,stroke:#E6C200,color:#333;
  classDef action  fill:#CDEFD9,stroke:#4CAF7D,color:#333;
  classDef session fill:#E6DAF7,stroke:#9B72CF,color:#333;
  classDef audit   fill:#FBD5DD,stroke:#E0708A,color:#333;
  classDef reject  fill:#FCE0C8,stroke:#E8954A,color:#333;
```

**Shapes (locked):** `[process]` · `{decision}` · `[(database)]` · `([start/end])` · `[/input/]`

**6-class color legend (never invent new colors):**

| Class | Meaning |
|-------|---------|
| guard | permission / validation |
| action | data write |
| lookup | fetch |
| session | confirm / session |
| audit | audit write |
| reject | error path |

Design-doc diagrams are HLD (logical flow). Node-by-node LLD stays in the source canvas/code.

## png/

Hero PNGs (exported from Excalidraw) go in [`png/`](png/).
