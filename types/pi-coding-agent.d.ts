// Minimal stub for @mariozechner/pi-coding-agent — resolves B1 (type-checking)
// Kept manually; update when the peer dependency evolves.

declare module "@mariozechner/pi-coding-agent" {
	export interface ExtensionAPI {
		registerCommand(
			name: string,
			handler: {
				description: string;
				handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
			},
		): void;
		on<T extends string>(
			event: T,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			listener: (event: any, ctx: { cwd: string }) => void | undefined | Promise<void | undefined> | { block: boolean; reason: string } | Promise<{ block: boolean; reason: string } | undefined>,
		): void;
	}

	export interface ExtensionCommandContext {
		cwd: string;
		hasUI: boolean;
		isIdle(): boolean;
		model?: {
			provider: string;
			id: string;
		};
		ui: {
			editor(title: string, defaultValue: string): Promise<string | undefined>;
			input(title: string, defaultValue?: string): Promise<string | undefined>;
			notify(message: string, level: "info" | "warning" | "error"): void;
			setStatus(key: string, value: string | undefined): void;
			setWorkingMessage?(message: string | undefined): void;
			setWidget(key: string, lines: string[]): void;
			setWorkingVisible?(visible: boolean): void;
		};
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
