import { execSync, spawn, type ExecSyncOptions } from "node:child_process";
import { platform } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@mariozechner/pi-tui";

type TextPart = { type: string; text?: string };

type MessageEntry = {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

type PromptSectionKey =
	| "base"
	| "projectContext"
	| "skills"
	| "extension"
	| "unclassified";

type PromptSection = {
	key: PromptSectionKey;
	label: string;
	content: string;
};

const approxTokens = (text: string) => Math.ceil(text.length / 4);
const countLines = (text: string) => (text.length === 0 ? 0 : text.split("\n").length);
const SYSTEM_PROMPT_BASE_TAIL =
	"- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)";
const SYSTEM_PROMPT_FOOTER_PATTERN =
	/\nCurrent date:[\s\S]*\nCurrent working directory:[^\n]*$/;
const PROJECT_CONTEXT_HEADING = "\n\n# Project Context\n\n";

const copyToClipboardQuietly = async (text: string) => {
	const options: ExecSyncOptions = { input: text, timeout: 5000, stdio: ["pipe", "ignore", "ignore"] };
	const p = platform();

	if (p === "darwin") {
		execSync("pbcopy", options);
		return;
	}

	if (p === "win32") {
		execSync("clip", options);
		return;
	}

	if (process.env.TERMUX_VERSION) {
		try {
			execSync("termux-clipboard-set", options);
			return;
		} catch {
			// Fall back to Linux desktop tools.
		}
	}

	if (process.env.WAYLAND_DISPLAY) {
		try {
			execSync("which wl-copy", { stdio: "ignore" });
			const proc = spawn("wl-copy", [], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
			proc.stdin.on("error", () => undefined);
			proc.stdin.write(text);
			proc.stdin.end();
			proc.unref();
			return;
		} catch {
			// Fall back to X11 tools when available.
		}
	}

	if (process.env.DISPLAY) {
		try {
			execSync("xclip -selection clipboard", options);
			return;
		} catch {
			execSync("xsel --clipboard --input", options);
			return;
		}
	}

	throw new Error("Failed to copy to clipboard");
};

const statsLine = (label: string, text: string) =>
	`- ${label}: ${text.length} chars, ${countLines(text)} lines, ~${approxTokens(text)} tokens`;

const extractText = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is TextPart => Boolean(part) && typeof part === "object" && "type" in part && part.type === "text" && typeof part.text === "string")
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

const findFirstIndex = (text: string, patterns: RegExp[]) => {
	let bestIndex = -1;
	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		const match = pattern.exec(text);
		if (!match || match.index < 0) continue;
		if (bestIndex === -1 || match.index < bestIndex) {
			bestIndex = match.index;
		}
	}
	return bestIndex;
};

const extractSkillsSection = (text: string) => {
	const introPattern = /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/;
	const xmlPattern = /\n*<available_skills>[\s\S]*?<\/available_skills>/;
	const introMatch = introPattern.exec(text);
	if (introMatch) {
		return {
			start: introMatch.index,
			end: introMatch.index + introMatch[0].length,
			content: introMatch[0],
		};
	}

	const xmlMatch = xmlPattern.exec(text);
	if (xmlMatch) {
		return {
			start: xmlMatch.index,
			end: xmlMatch.index + xmlMatch[0].length,
			content: xmlMatch[0],
		};
	}

	return null;
};

const extractProjectContextSection = (text: string, sectionEnd: number) => {
	const headingIndex = text.indexOf(PROJECT_CONTEXT_HEADING);
	if (headingIndex === -1 || headingIndex >= sectionEnd) {
		return null;
	}

	return {
		start: headingIndex,
		end: sectionEnd,
		content: text.slice(headingIndex, sectionEnd),
	};
};

const buildPromptSections = (systemPrompt: string): PromptSection[] => {
	const footerIndex = findFirstIndex(systemPrompt, [SYSTEM_PROMPT_FOOTER_PATTERN]);
	const promptBody = footerIndex >= 0 ? systemPrompt.slice(0, footerIndex) : systemPrompt;
	const sections: PromptSection[] = [];

	const skillsSection = extractSkillsSection(promptBody);
	const projectContextSection = extractProjectContextSection(
		promptBody,
		skillsSection ? skillsSection.start : promptBody.length,
	);
	const preludeEnd = Math.min(
		projectContextSection?.start ?? promptBody.length,
		skillsSection?.start ?? promptBody.length,
	);
	const prelude = promptBody.slice(0, preludeEnd);

	if (prelude.length > 0) {
		const tailIndex = prelude.indexOf(SYSTEM_PROMPT_BASE_TAIL);
		if (tailIndex >= 0) {
			const baseEnd = tailIndex + SYSTEM_PROMPT_BASE_TAIL.length;
			const baseContent = prelude.slice(0, baseEnd);
			const extensionContent = prelude.slice(baseEnd);
			sections.push({ key: "base", label: "Base prompt / core instructions", content: baseContent });
			if (extensionContent.length > 0) {
				sections.push({
					key: "extension",
					label: "Extension-added prompt text",
					content: extensionContent,
				});
			}
		} else {
			sections.push({ key: "base", label: "Base prompt / core instructions", content: prelude });
		}
	}

	if (projectContextSection) {
		sections.push({
			key: "projectContext",
			label: "AGENTS.md / CONTEXT.md / project-context additions",
			content: projectContextSection.content,
		});
	}

	if (skillsSection) {
		sections.push({
			key: "skills",
			label: "Available skills block",
			content: skillsSection.content,
		});
	}

	const consumed = Math.max(
		preludeEnd,
		projectContextSection?.end ?? preludeEnd,
		skillsSection?.end ?? preludeEnd,
	);
	sections.push({
		key: "unclassified",
		label: "Unknown / unclassified remainder",
		content: promptBody.slice(consumed),
	});

	return sections;
};

const buildReport = (ctx: ExtensionCommandContext, mode: "summary" | "full", pi: ExtensionAPI) => {
	const systemPrompt = ctx.getSystemPrompt();
	const promptSections = buildPromptSections(systemPrompt);
	const lastUserMessage = getLastUserMessage(ctx);
	const activeTools = pi.getActiveTools();
	const commands = pi.getCommands().map((command) => command.name).sort();
	const promptSectionSummary = promptSections.map((section) => statsLine(section.label, section.content));

	const lines = [
		"# Prompt Stats",
		"",
		"## Summary",
		statsLine("System prompt", systemPrompt),
		"## System prompt breakdown",
		...promptSectionSummary,
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
		for (const section of promptSections) {
			lines.push("", `## ${section.label}`, "```text", section.content || "", "```");
		}

		lines.push(
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
					await copyToClipboardQuietly(report);
					if (ctx.hasUI) ctx.ui.notify("Report copied to clipboard", "info");
				} catch (e: any) {
					if (ctx.hasUI) ctx.ui.notify(`Copy failed: ${e.message}`, "error");
				}
				return;
			}

			const reportMode = mode === "full" ? "full" : "summary";
			const report = buildReport(ctx, reportMode, pi);
			await showReport(report, ctx);
			if (ctx.hasUI) {
				const sysPrompt = ctx.getSystemPrompt();
				ctx.ui.notify(`System prompt: ${sysPrompt.length} chars, ~${approxTokens(sysPrompt)} tokens`, "info");
			}
		},
	});
}
