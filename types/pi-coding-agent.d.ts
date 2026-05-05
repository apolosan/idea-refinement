// Minimal stub for @mariozechner/pi-coding-agent — resolves local type-checking.
// Kept manually; update when the peer dependency evolves.

declare module "@mariozechner/pi-coding-agent" {
	export interface ExtensionUIContext {
		editor(title: string, defaultValue: string): Promise<string | undefined>;
		input(title: string, defaultValue?: string): Promise<string | undefined>;
		notify(message: string, level: "info" | "warning" | "error"): void;
		setStatus(key: string, value: string | undefined): void;
		setWorkingMessage?(message: string | undefined): void;
		setWorkingVisible?(visible: boolean): void;
		setWorkingIndicator?(options?: { frames?: string[]; intervalMs?: number }): void;
		setWidget(key: string, lines: string[] | undefined): void;
		theme: {
			fg(color: string, text: string): string;
		};
	}

	export interface ExtensionContext {
		cwd: string;
		hasUI: boolean;
		isIdle(): boolean;
		ui: ExtensionUIContext;
		abort?(): void;
		model?: {
			provider: string;
			id: string;
		};
	}

	export interface ExtensionCommandContext extends ExtensionContext {}

	export interface ExtensionAPI {
		registerCommand(
			name: string,
			handler: {
				description: string;
				handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
			},
		): void;
		registerShortcut(
			shortcut: string,
			options: {
				description?: string;
				handler: (ctx: ExtensionContext) => Promise<void> | void;
			},
		): void;
		setActiveTools(toolNames: string[]): void;
		on<T extends string, E = unknown>(
			event: T,
			listener: (
				event: E,
				ctx: { cwd: string },
			) => void | undefined | Promise<void | undefined> | { block: boolean; reason: string } | Promise<{ block: boolean; reason: string } | undefined>,
		): void;
	}

	export interface ToolCallEvent<T extends string> {
		type: "tool_call";
		toolName: T;
		input: Record<string, unknown>;
	}

	export function isToolCallEventType<T extends string>(
		type: T,
		event: unknown,
	): event is ToolCallEvent<T>;
}
