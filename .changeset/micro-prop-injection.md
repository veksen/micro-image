---
"@micro-image/image": minor
---

Add an optional `_micro` prop that carries build-time metadata, and export its type as
`MicroImage`.

`<Image _micro={{ src, width, height, placeholder }} />` renders without `src`, `width` or
`height` written. Written props win over `_micro`. `width` and `height` are taken as a pair:
writing only one of them is ignored, and the aspect ratio comes from `_micro`. `placeholder`
is accepted but not rendered yet.

`IImageProps` changes from an interface to a union type, so that either `src`, `width` and
`height` or `_micro` satisfies it. Code that extends `IImageProps` in an `interface` no longer
compiles. Use a type intersection instead.
