import { describe, it, expect, vi, beforeEach } from "vitest";
import promptStatsExtension from "../index";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...original,
		writeFile: vi.fn(),
	};
});

describe("prompt-stats extension", () => {
	let mockPi: any;
	let mockCtx: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPi = {
			registerCommand: vi.fn(),
			getActiveTools: vi.fn().mockReturnValue(["tool1"]),
			getCommands: vi.fn().mockReturnValue([{ name: "cmd1" }]),
		};
		mockCtx = {
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
		
		mockPi.clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
		
		await handler("copy", mockCtx);
		
		expect(mockPi.clipboard.writeText).toHaveBeenCalled();
		expect(mockCtx.ui.notify).toHaveBeenCalledWith("Report copied to clipboard", "info");
	});

	it("handles 'save' mode with path", async () => {
		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		vi.mocked(fs.writeFile).mockResolvedValue(undefined);

		await handler("save report.md", mockCtx);
		
		expect(fs.writeFile).toHaveBeenCalledWith("report.md", expect.any(String));
		expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("saved to report.md"), "info");
	});

	it("handles 'save' mode with default path", async () => {
		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		vi.mocked(fs.writeFile).mockResolvedValue(undefined);

		await handler("save", mockCtx);
		
		expect(fs.writeFile).toHaveBeenCalledWith("prompt-stats.md", expect.any(String));
		expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("saved to prompt-stats.md"), "info");
	});

	it("reports error on save failure", async () => {
		promptStatsExtension(mockPi);
		const handler = mockPi.registerCommand.mock.calls[0][1].handler;

		vi.mocked(fs.writeFile).mockRejectedValue(new Error("Permission denied"));

		await handler("save /root/report.md", mockCtx);
		
		expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Permission denied"), "error");
	});
});
