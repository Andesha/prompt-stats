import { describe, it, expect, vi, beforeEach } from "vitest";
import promptStatsExtension from "../index.js";
import { execSync } from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:child_process")>();
	return {
		...original,
		execSync: vi.fn(),
		spawn: vi.fn(),
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

	it("handles 'copy' mode", async () => {
		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		await handler("copy", mockCtx);

		expect(execSync).toHaveBeenCalledWith("xclip -selection clipboard", expect.objectContaining({ input: expect.stringContaining("# Prompt Stats") }));
		expect(mockCtx.ui.notify).toHaveBeenCalledWith("Report copied to clipboard", "info");
	});
});
