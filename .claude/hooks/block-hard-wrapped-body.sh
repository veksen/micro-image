#!/bin/bash
# PreToolUse(Bash): block hard-wrapped PR bodies, issue bodies, and comments.
#
# GitHub renders a single newline in an issue body, PR body, or comment as a
# line break. The same text in a .md file in the repo folds into a paragraph,
# so hard-wrapping prose at 72-80 columns is correct in a commit message and
# wrong here. This gate catches the habit before it ships.
#
# Ported from Query-Doctor/Site 0418e8616 with two extraction fixes; see
# .claude/hooks/block-hard-wrapped-body.test.sh for the cases that pin them.
cmd=$(jq -r '.tool_input.command // ""')

echo "$cmd" | grep -qE 'gh (pr|issue) (create|edit|comment)' || exit 0

reason=$(printf '%s' "$cmd" | python3 -c '
import os, re, sys

text = sys.stdin.read()

# `gh` takes a body three ways, and an agent in this repo usually picks the
# third. Collect every one of them rather than guessing which is in play.
bodies = []

# 1. Heredoc payload, for a body written inline.
for m in re.finditer(r"<<-?[\x27\"]?(\w+)[\x27\"]?\n(.*?)\n\1\b", text, re.S):
    bodies.append(m.group(2))

# 2. --body-file/-F names a file. The upstream hook missed this entirely: its
# fallback matched `--body\b`, and \b matches inside `--body-file` because `-`
# is not a word character, so the file path was read as the body and the gate
# passed. That is the invocation this repo actually publishes with.
for m in re.finditer(
    r"(?:--body-file|(?<![\w-])-F)[=\s]+([\x27\"]?)([^\x27\"\s]+)\1", text
):
    path = m.group(2)
    # "-" is stdin, which is not ours to read, and the file may not be written
    # yet. Skip rather than block on a body we cannot see.
    if path == "-":
        continue
    try:
        with open(os.path.expanduser(path), encoding="utf-8", errors="replace") as fh:
            bodies.append(fh.read())
    except OSError:
        continue

# 3. --body/-b with an inline string. Capture the argument itself, not the rest
# of the command: `--body(.*)` with DOTALL swallows trailing `--label` and
# `--assignee` continuation lines and reads them as wrapped prose, so a clean
# one-line body was rejected. The lookarounds keep --body-file out of this arm.
m = re.search(
    r"(?:--body(?![\w-])|(?<![\w-])-b(?![\w-]))[=\s]+"
    r"(\x27[^\x27]*\x27|\"(?:[^\"\\]|\\.)*\"|\S+)",
    text,
    re.S,
)
if m:
    arg = m.group(1)
    if len(arg) >= 2 and arg[0] == arg[-1] and arg[0] in "\x27\"":
        arg = arg[1:-1]
    bodies.append(arg)

# Short adjacent lines are correct in code, headings, list items, tables,
# blockquotes and HTML, so only prose is judged.
SKIP = re.compile(r"""^\s*($|\#|[-*+]\s|[0-9]+[.)]\s|>|\||```|~~~|\[|!\[|<)""")
INDENTED_CODE = re.compile(r"^(?: {4,}|\t)")


def first_wrapped(body):
    """Return the first line that looks like a wrap fragment, or None.

    Two adjacent prose lines where the first stops short of the margin is the
    signature of a hard wrap: real one-per-paragraph prose runs long and is
    separated by blank lines.
    """
    fence = False
    prev = None  # previous prose line, or None
    for raw in body.split("\n"):
        line = raw.rstrip()
        if re.match(r"^\s*(```|~~~)", line):
            fence = not fence
            prev = None
            continue
        if fence or INDENTED_CODE.match(line) or SKIP.match(line):
            prev = None
            continue
        if prev is not None and len(prev) < 100:
            return prev.strip()[:70]
        prev = line
    return None


for body in bodies:
    hit = first_wrapped(body)
    if hit:
        print(hit)
        sys.exit(0)
' 2>/dev/null)

if [ -n "$reason" ]; then
  cat >&2 <<EOF
Blocked: the body looks hard-wrapped. GitHub renders every newline in a PR or
issue body as a line break, so wrapped prose shows up ragged.

First wrapped line: "$reason"

Put each paragraph on one line and separate paragraphs with a blank line. Do not
wrap at 72 or 80 columns. That convention is for commit messages, which this is
not.
EOF
  exit 2
fi
exit 0
