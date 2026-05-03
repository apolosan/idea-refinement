const UNICODE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_FRAMES = ["|", "/", "-", "\\"];
const DEFAULT_INTERVAL_MS = 80;

export interface SpinnerOptions {
	/** Interval between frame updates in milliseconds. Default: 80ms. */
	intervalMs?: number;
	/** Called on every tick with the current frame and optional message. */
	onFrame: (frame: string, message?: string) => void;
	/** Use Unicode braille patterns when true; ASCII fallback when false. */
	useUnicode?: boolean;
}

/**
 * Active terminal spinner that rotates frames while a long-running operation
 * is in progress. Integrates with Pi's setWorkingMessage for animated UI.
 */
export class Spinner {
	private readonly frames: string[];
	private readonly intervalMs: number;
	private readonly onFrame: (frame: string, message?: string) => void;
	private currentMessage?: string;
	private timer?: ReturnType<typeof setInterval>;
	private index = 0;
	private isRunning = false;

	constructor(options: SpinnerOptions) {
		this.frames = options.useUnicode !== false ? UNICODE_FRAMES : ASCII_FRAMES;
		this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.onFrame = options.onFrame;
	}

	/**
	 * Start the spinner. If already running, this is a no-op.
	 * @param message Optional contextual message to display alongside the frame.
	 */
	start(message?: string): void {
		if (this.isRunning) return;
		this.currentMessage = message;
		this.isRunning = true;
		this.index = 0;
		this.tick();
		this.timer = setInterval(() => this.tick(), this.intervalMs);
	}

	/**
	 * Update the contextual message without stopping the spinner.
	 * If not running, starts the spinner with the given message.
	 * @param message New contextual message.
	 */
	update(message?: string): void {
		this.currentMessage = message;
		if (!this.isRunning) {
			this.start(message);
		} else {
			this.tick();
		}
	}

	/** Stop the spinner and clear the interval. */
	stop(): void {
		this.isRunning = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	/** Whether the spinner is currently active. */
	get running(): boolean {
		return this.isRunning;
	}

	private tick(): void {
		const frame = this.frames[this.index];
		this.onFrame(frame, this.currentMessage);
		this.index = (this.index + 1) % this.frames.length;
	}
}
