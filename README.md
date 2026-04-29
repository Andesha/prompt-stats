# prompt-stats

MIT licensed.

A small Pi extension that adds `/prompt-stats`.

It shows:
- the current effective system prompt
- chars / lines / approximate tokens
- the `<available_skills>` block size
- the last user message size (useful for prompt-template expansion)
- active tool names

## Install

```bash
pi install /home/tk11br/Documents/prompt-stats
```

## Usage

```text
/prompt-stats
```

Optional modes:

```text
/prompt-stats summary   # summary only
/prompt-stats full      # include full system prompt and last user message
```
