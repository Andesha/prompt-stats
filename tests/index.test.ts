import { describe, it, expect, vi, beforeEach } from "vitest";
import promptStatsExtension from "../index.js";
import { execSync } from "node:child_process";
import { Markdown } from "@mariozechner/pi-tui";

vi.mock("node:child_process", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:child_process")>();
	return {
		...original,
		execSync: vi.fn(),
		spawn: vi.fn(),
	};
});

vi.mock("@mariozechner/pi-tui", async (importOriginal) => {
	const original = await importOriginal<typeof import("@mariozechner/pi-tui")>();
	
	class MockContainer {
		addChild = vi.fn();
		render = vi.fn();
		invalidate = vi.fn();
	}
	class MockMarkdown {
		static mock = vi.fn();
		constructor(public text: string) {
			MockMarkdown.mock(text);
		}
	}
	class MockText {
		constructor(public text: string) {}
	}

	return {
		...original,
		Container: MockContainer,
		Markdown: MockMarkdown,
		Text: MockText,
	};
});

describe("prompt-stats extension", () => {
	let mockPi: any;
	let mockCtx: any;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DISPLAY = ":0";
		mockPi = {
			registerCommand: vi.fn(),
			getActiveTools: vi.fn().mockReturnValue(["tool1"]),
			getCommands: vi.fn().mockReturnValue([{ name: "cmd1" }]),
		};
		mockCtx = {
			cwd: "/workspace",
			getSystemPrompt: vi.fn().mockReturnValue("system prompt"),
			sessionManager: {
				getBranch: vi.fn().mockReturnValue([
					{
						type: "message",
						message: { role: "user", content: "user message" },
					},
				]),
			},
			hasUI: true,
			ui: {
				custom: vi.fn().mockResolvedValue(undefined),
				notify: vi.fn(),
			},
		};
	});

	it("registers the prompt-stats command", () => {
		promptStatsExtension(mockPi);
		expect(mockPi.registerCommand).toHaveBeenCalledWith("prompt-stats", expect.any(Object));
	});

	it("defaults to summary mode when no arguments are provided", async () => {
		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		await handler("", mockCtx);

		const callback = mockCtx.ui.custom.mock.calls[0][0];
		const theme = { fg: (c: string, s: string) => s, bold: (s: string) => s };
		const done = vi.fn();
		callback(null, theme, null, done);

		expect((Markdown as any).mock).toHaveBeenCalledWith(expect.not.stringContaining("## Full system prompt"));
	});

	it("uses full mode when 'full' argument is provided", async () => {
		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		await handler("full", mockCtx);

		const callback = mockCtx.ui.custom.mock.calls[0][0];
		const theme = { fg: (c: string, s: string) => s, bold: (s: string) => s };
		const done = vi.fn();
		callback(null, theme, null, done);

		expect((Markdown as any).mock).toHaveBeenCalledWith(expect.stringContaining("## Base prompt / core instructions"));
		expect((Markdown as any).mock).toHaveBeenCalledWith(expect.stringContaining("## Unknown / unclassified remainder"));
	});

	it("uses summary mode when 'summary' argument is provided", async () => {
		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		await handler("summary", mockCtx);

		const callback = mockCtx.ui.custom.mock.calls[0][0];
		const theme = { fg: (c: string, s: string) => s, bold: (s: string) => s };
		const done = vi.fn();
		callback(null, theme, null, done);

		expect((Markdown as any).mock).toHaveBeenCalledWith(expect.not.stringContaining("## Full system prompt"));
	});

	it("handles 'copy' mode", async () => {
		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		await handler("copy", mockCtx);

		expect(execSync).toHaveBeenCalledWith("xclip -selection clipboard", expect.objectContaining({ input: expect.stringContaining("# Prompt Stats") }));
		expect(mockCtx.ui.notify).toHaveBeenCalledWith("Report copied to clipboard", "info");
	});

	it("breaks the system prompt into source sections in summary mode", async () => {
		mockCtx.getSystemPrompt.mockReturnValue(
			[
				"Base prompt line 1",
				"Base prompt line 2",
				"- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)",
				"extension-added text",
				"",
				"# Project Context",
				"",
				"Project-specific instructions and guidelines:",
				"",
				"## /workspace/AGENTS.md",
				"",
				"agent instructions",
				"",
				"The following skills provide specialized instructions for specific tasks.",
				"Use the read tool to load a skill's file when the task matches its description.",
				"<available_skills>",
				"  <skill>",
				"    <name>test-skill</name>",
				"    <description>Does a thing</description>",
				"    <location>/workspace/.sandcastle/skills/test-skill/SKILL.md</location>",
				"  </skill>",
				"</available_skills>",
				"",
				"Current date: 2026-04-30",
				"Current working directory: /workspace",
			].join("\n"),
		);

		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		await handler("summary", mockCtx);

		const callback = mockCtx.ui.custom.mock.calls[0][0];
		const theme = { fg: (c: string, s: string) => s, bold: (s: string) => s };
		const done = vi.fn();
		callback(null, theme, null, done);

		expect((Markdown as any).mock).toHaveBeenCalledWith(
			expect.stringContaining("## System prompt breakdown"),
		);
		expect((Markdown as any).mock).toHaveBeenCalledWith(
			expect.stringContaining("Base prompt / core instructions"),
		);
		expect((Markdown as any).mock).toHaveBeenCalledWith(
			expect.stringContaining("AGENTS.md / CONTEXT.md / project-context additions"),
		);
		expect((Markdown as any).mock).toHaveBeenCalledWith(
			expect.stringContaining("Available skills block"),
		);
		expect((Markdown as any).mock).toHaveBeenCalledWith(
			expect.stringContaining("Extension-added prompt text"),
		);
		expect((Markdown as any).mock).toHaveBeenCalledWith(
			expect.stringContaining("Unknown / unclassified remainder"),
		);
	});
});
