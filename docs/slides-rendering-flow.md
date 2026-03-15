---
summary: "Map of slide extraction and rendering flow."
read_when:
  - "When changing slide output or streaming."
  - "When debugging slide rendering regressions."
---

# Slides Rendering Flow

## When debugging

1. Check state transitions before DOM issues.
2. Check stream policy before transport retry logic.
3. Check cache/hydration helpers before blaming rendering.
