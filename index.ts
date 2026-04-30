import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@mariozechner/pi-tui";
import * as fs from "node:fs/promises";

type TextPart = { type: string; text?: string };

type MessageEntry = {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

const approxTokens = (text: string) => Math.ceil(text.length / 4);
const countLines = (text: string) => (text.length === 0 ? 0 : text.split("\n").length);

const statsLine = (label: string, text: string) =>
	`- ${label}: ${text.length} chars, ${countLines(text)} lines, ~${approxTokens(text)} tokens`;

const extractText = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is TextPart => Boolean(part) && typeof part === "object" && "type" in part)
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
};

const getLastUserMessage = (ctx: ExtensionCommandContext): string => {
	const branch = ctx.sessionManager.getBranch() as MessageEntry[];
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		if (entry.message?.role !== "user") continue;
		const text = extractText(entry.message.content).trim();
		if (text.length > 0) return text;
	}
	return "";
};

const buildReport = (ctx: ExtensionCommandContext, mode: "summary" | "full", pi: ExtensionAPI) => {
	const systemPrompt = ctx.getSystemPrompt();
	const skillsBlock = (systemPrompt.match(/<available_skills>[\s\S]*?<\/available_skills>/) || [""])[0];
	const lastUserMessage = getLastUserMessage(ctx);
	const activeTools = pi.getActiveTools();
	const commands = pi.getCommands().map((command) => command.name).sort();

	const lines = [
		"# Prompt Stats",
		"",
		"## Summary",
		statsLine("System prompt", systemPrompt),
		statsLine("Available skills block", skillsBlock),
		statsLine("Last user message", lastUserMessage),
		`- Active tools: ${activeTools.length}`,
		`- Slash commands: ${commands.length}`,
		"",
		"## Notes",
		"- Skills contribute to the system prompt via `<available_skills>`.",
		"- Prompt templates usually affect the user message, not the system prompt.",
		"- Token counts are approximate: `ceil(chars / 4)`.",
		"",
		"## Active tools",
		activeTools.length > 0 ? activeTools.map((tool) => `- ${tool}`).join("\n") : "- none",
		"",
		"## Slash commands",
		commands.length > 0 ? commands.map((command) => `- /${command}`).join("\n") : "- none",
	];

	if (mode === "full") {
		lines.push(
			"",
			"## Full system prompt",
			"```text",
			systemPrompt || "",
			"```",
			"",
			"## Last user message",
			"```text",
			lastUserMessage || "",
			"```",
		);
	}

	return lines.join("\n");
};

const showReport = async (report: string, ctx: ExtensionCommandContext) => {
	if (!ctx.hasUI) return;

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = new DynamicBorder((s: string) => theme.fg("accent", s));
		const mdTheme = getMarkdownTheme();

		container.addChild(border);
		container.addChild(new Text(theme.fg("accent", theme.bold("Prompt Stats")), 1, 0));
		container.addChild(new Markdown(report, 1, 1, mdTheme));
		container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
		container.addChild(border);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) done(undefined);
			},
		};
	});
};

export default function promptStatsExtension(pi: ExtensionAPI) {
	pi.registerCommand("prompt-stats", {
		description: "Show the current system prompt and prompt-size stats",
		handler: async (args, ctx) => {
			const argParts = args.trim().split(/\s+/);
			const mode = argParts[0]?.toLowerCase();

			if (mode === "copy") {
				const report = buildReport(ctx, "full", pi);
				try {
					// @ts-expect-error - clipboard might not be on ExtensionAPI yet
					if (pi.clipboard?.writeText) {
						// @ts-expect-error - clipboard might not be on ExtensionAPI yet
						await pi.clipboard.writeText(report);
						if (ctx.hasUI) ctx.ui.notify("Report copied to clipboard", "info");
					} else {
						throw new Error("Clipboard not available");
					}
				} catch (e: any) {
					if (ctx.hasUI) ctx.ui.notify(`Copy failed: ${e.message}`, "error");
				}
				return;
			}

			if (mode === "save") {
				const report = buildReport(ctx, "full", pi);
				const path = argParts[1] || "prompt-stats.md";
				try {
					await fs.writeFile(path, report);
					if (ctx.hasUI) ctx.ui.notify(`Report saved to ${path}`, "info");
				} catch (e: any) {
					if (ctx.hasUI) ctx.ui.notify(`Save failed: ${e.message}`, "error");
				}
				return;
			}

			const reportMode = mode === "summary" ? "summary" : "full";
			const report = buildReport(ctx, reportMode, pi);
			await showReport(report, ctx);
			if (ctx.hasUI) {
				const sysPrompt = ctx.getSystemPrompt();
				ctx.ui.notify(`System prompt: ${sysPrompt.length} chars, ~${approxTokens(sysPrompt)} tokens`, "info");
			}
		},
	});
}
