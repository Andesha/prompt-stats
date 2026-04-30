# prompt-stats

Know exactly what's inflating your Pi prompt before it eats your context window.

A small Pi extension that adds `/prompt-stats` so you can measure the before/after impact of tools, skills, plugins, extensions, and prompt-template expansion.

It shows:
- the current effective system prompt
- chars / lines / approximate tokens
- a breakdown for base prompt, project context, skills, extension text, and any unclassified remainder
- the last user message size (useful for prompt-template expansion)
- active tool names

## Install

Clone the repo somewhere local, then install that local path:

```bash
git clone git@github.com:Andesha/prompt-stats.git
pi install ./prompt-stats
```

## Usage

```text
/prompt-stats
```
Defaults to summary mode.

Optional modes:

```text
/prompt-stats summary   # summary only
/prompt-stats full      # show each system prompt section under its own heading
/prompt-stats copy      # copy full report via Pi's clipboard API
```
