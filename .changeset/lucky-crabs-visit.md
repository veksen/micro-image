---
"@micro-image/image": minor
---

Generate ipx URLs that ipx actually accepts.

The `ipx` provider built its modifier list from an object that also carried
`image: encodeURIComponent(src)`, so every URL led with an `image_https%3A%2F%2F…`
segment. ipx has no `image` modifier and already takes the source from the path
segment after the modifiers, so the source was sent twice. ipx skips modifiers it
has no handler for, so this was dead weight rather than an error: a longer URL and
a cache key nobody can read. The modifier list now holds only the transforms the
caller asked for (`width`, `format`, `quality`, `blur`), values encoded so a
caller-supplied `format` cannot inject a second modifier.

The source was appended raw while its unnecessary copy was the encoded one —
exactly backwards. What that costs depends on the ipx version. ipx 2.x and 3.x
parse the request with `event.path`, which keeps the query string, so a source
like `photo.jpg?v=1` survived by accident. ipx 4 parses `new URL(url).pathname`,
which drops it, and fetches the source without its query string — measured on a
running instance, the proxy returned the wrong upstream image. The source is now
percent-encoded as a single path segment and survives ipx's `decodeURIComponent`
intact on every version.

A request with no transform options now emits ipx's `_` no-op modifier segment
instead of an empty one, which ipx answers with `400 IPX_MISSING_MODIFIERS`.

Every URL the `ipx` provider generates changes shape. Verified against running
ipx 2.1.1, 3.1.1 and 4.0.0-beta.1 instances.
