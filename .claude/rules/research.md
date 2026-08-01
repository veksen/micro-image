---
globs: "*"
---

# Research Rules

## When to Research

- Unfamiliar library or API
- Unfamiliar codebase pattern
- Integrating a third-party service
- A fix attempt has failed

## How to Research

1. Read this project's own code first — grep for existing usage patterns.
2. Read official documentation (context7, or WebFetch). Don't rely on training data for
   library APIs.
3. Read dependency source when docs are insufficient — especially for bundler plugin hooks,
   AST/parser scope APIs, and image-format edge cases.
4. Use subagents for deep research to avoid polluting main context.
5. Summarize findings before implementing.

## Image formats and bytes

Never infer a format from a byte offset without checking the actual specification for that
format. BUG-18 in `BUGS.md` exists because a GIF field offset was read out of a JPEG, and
because the check used bitwise AND where it meant equality. When parsing image headers, cite
the spec section in a comment and pin the behavior with a test over a real fixture.

## Third-party proxies

`ipx` and `imgproxy` each have their own URL grammar, and the repo has already shipped four
bugs from guessing at it (bogus `image_` modifier, unencoded source, padded base64 instead of
base64url, missing signature segment). Read the provider's URL documentation and verify
against a running instance before changing a `generateUrl`.

## Planning

For non-trivial changes (>20 lines, new feature, architectural): write a plan stating what
files change, the approach, and the risks. Wait for confirmation.
