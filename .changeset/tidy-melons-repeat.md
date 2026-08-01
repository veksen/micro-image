---
"@micro-image/image": patch
---

Fix the import path in the readme.

Both usage examples imported from `@micro-image/react`, which is not a
published package. The correct specifier is `@micro-image/image`, which the
readme's own title and install command already used.

npm always ships `README.md`, so the broken examples were reaching everyone
who opened the package page. This patch exists to publish the corrected file.
