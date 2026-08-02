---
"@micro-image/image": minor
---

Generate imgproxy URLs that imgproxy actually accepts.

Every URL the imgproxy provider produced was rejected, for two independent
reasons. The source was encoded with `btoa`, which emits padded standard
base64, where imgproxy requires unpadded base64url — so `=`, `+` and `/` landed
in the path, and a `/` split the segment. And the path carried no signature
segment, so imgproxy read the first processing option as the signature and
answered 403.

The source is now unpadded base64url, and the signature position always carries
the literal `insecure`. Signed URLs are not generated: the key would have to
ship to the browser to compute the HMAC, so an imgproxy deployment used with
this provider has to run with no `IMGPROXY_KEY` and no `IMGPROXY_SALT`.

Characters outside printable ASCII are percent-encoded before the base64.
imgproxy hands the decoded source straight to its HTTP client, which refuses a
URL carrying a raw non-ASCII or control character with "Source is unreachable".
Printable ASCII is left as it was, so an already-escaped source is not escaped
twice.

Each processing option is now built from its own arguments, so an argument that
was not supplied drops out instead of emitting `undefined` — the old
single-element arrays were correct only because they held exactly one value.

`el:1` and `ex:1` are no longer emitted. They were hardcoded onto every URL,
forcing imgproxy to upscale originals smaller than the requested width and to
pad the result to that size. Both now follow imgproxy's own defaults, so a
small original stays small instead of being blown up.

URLs generated for the same props change shape, and any cache keyed on them
sees a one-time miss.
