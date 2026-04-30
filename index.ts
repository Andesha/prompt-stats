import { execSync, spawn, type ExecSyncOptions } from "node:child_process";
import { platform } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext, ToolInfo } from "@mariozechner/pi-coding-agent";
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

type ToolSizeEntry = {
	name: string;
	descriptionLength: number;
	schemaLength: number;
	serializedLength: number;
	approxTokens: number;
	descriptionMissing: boolean;
	schemaMissing: boolean;
};

const approxTokens = (text: string) => Math.ceil(text.length / 4);
const approxTokensFromChars = (chars: number) => Math.ceil(chars / 4);
const countLines = (text: string) => (text.length === 0 ? 0 : text.split("\n").length);
const safeJsonLength = (value: unknown) => {
	try {
		const serialized = JSON.stringify(value);
		return serialized ? serialized.length : 0;
	} catch {
		return 0;
	}
};
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

const buildToolSizeEntry = (tool: ToolInfo): ToolSizeEntry => {
	const description = typeof tool.description === "string" ? tool.description : "";
	const schemaMissing = tool.parameters === undefined || tool.parameters === null;
	const schemaLength = schemaMissing ? 0 : safeJsonLength(tool.parameters);
	const serializedLength = safeJsonLength({
		name: tool.name,
		description,
		parameters: tool.parameters ?? null,
	});

	return {
		name: tool.name,
		descriptionLength: description.length,
		schemaLength,
		serializedLength,
		approxTokens: approxTokensFromChars(serializedLength),
		descriptionMissing: description.length === 0,
		schemaMissing,
	};
};

const buildToolSizeReport = (activeToolNames: string[], allTools: ToolInfo[]) => {
	const allToolsByName = new Map(allTools.map((tool) => [tool.name, tool]));
	const activeToolEntries = activeToolNames
		.map((toolName) => {
			const tool = allToolsByName.get(toolName);
			if (!tool) {
				return {
					name: toolName,
					descriptionLength: 0,
					schemaLength: 0,
					serializedLength: 0,
					approxTokens: 0,
					descriptionMissing: true,
					schemaMissing: true,
				} satisfies ToolSizeEntry;
			}

			return buildToolSizeEntry(tool);
		})
		.sort(
			(a, b) =>
				b.serializedLength - a.serializedLength ||
				b.schemaLength - a.schemaLength ||
				b.descriptionLength - a.descriptionLength ||
				a.name.localeCompare(b.name),
		);

	const totalSerializedLength = activeToolEntries.reduce((sum, tool) => sum + tool.serializedLength, 0);

	return {
		activeToolEntries,
		activeToolCount: activeToolEntries.length,
		totalSerializedLength,
		totalApproxTokens: approxTokensFromChars(totalSerializedLength),
	};
};

const formatToolSizeLine = (tool: ToolSizeEntry) => {
	const descriptionText = tool.descriptionMissing
		? "description unavailable"
		: `description ${tool.descriptionLength} chars`;
	const schemaText = tool.schemaMissing ? "schema unavailable" : `schema ${tool.schemaLength} chars`;

	return `- ${tool.name}: ${descriptionText}, ${schemaText}, serialized ${tool.serializedLength} chars, ~${tool.approxTokens} tokens`;
};

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
	const allTools = pi.getAllTools();
	const commands = pi.getCommands().map((command) => command.name).sort();
	const promptSectionSummary = promptSections.map((section) => statsLine(section.label, section.content));
	const toolReport = buildToolSizeReport(activeTools, allTools);
	const toolSummaryCount = Math.min(3, toolReport.activeToolEntries.length);
	const largestTools = toolReport.activeToolEntries.slice(0, toolSummaryCount);

	const lines = [
		"# Prompt Stats",
		"",
		"## Summary",
		statsLine("System prompt", systemPrompt),
		"## System prompt breakdown",
		...promptSectionSummary,
		statsLine("Last user message", lastUserMessage),
		"## Tool breakdown",
		`- Active tools: ${toolReport.activeToolCount}`,
		`- Total active tool schema size: ${toolReport.totalSerializedLength} chars, ~${toolReport.totalApproxTokens} tokens`,
		"## Largest tools",
		toolReport.activeToolEntries.length > 0
			? largestTools.map((tool) => formatToolSizeLine(tool)).join("\n")
			: "- none",
		`- Slash commands: ${commands.length}`,
		"",
		"## Notes",
		"- Skills contribute to the system prompt via `<available_skills>`.",
		"- Prompt templates usually affect the user message, not the system prompt.",
		"- Token counts are approximate: `ceil(chars / 4)`.",
		"- Tool sizes use `JSON.stringify()` length for parameter schema and full serialized tool payloads.",
		"",
		"## Slash commands",
		commands.length > 0 ? commands.map((command) => `- /${command}`).join("\n") : "- none",
	];

	if (mode === "full") {
		for (const section of promptSections) {
			lines.push("", `## ${section.label}`, "```text", section.content || "", "```");
		}

		lines.push("", "## Tool breakdown", `- Active tools: ${toolReport.activeToolCount}`);
		lines.push(`- Total active tool schema size: ${toolReport.totalSerializedLength} chars, ~${toolReport.totalApproxTokens} tokens`);
		lines.push("## Active tools");
		lines.push(toolReport.activeToolEntries.length > 0 ? toolReport.activeToolEntries.map((tool) => formatToolSizeLine(tool)).join("\n") : "- none");

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
