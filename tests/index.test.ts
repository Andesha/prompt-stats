import { describe, it, expect, vi, beforeEach } from "vitest";
import promptStatsExtension from "../index.js";
import { execSync } from "node:child_process";
import { Container, Markdown } from "@mariozechner/pi-tui";

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

		expect((Markdown as any).mock).toHaveBeenCalledWith(expect.stringContaining("## Full system prompt"));
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
});
