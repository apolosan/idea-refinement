export interface ControlledStageProcessHandle {
	pause(): void;
	resume(): void;
	stop(reason?: string): void;
}

export class WorkflowRuntimeControl {
	private currentHandle?: ControlledStageProcessHandle;
	private runStartedAt?: number;
	private paused = false;
	private stopRequested = false;
	private stopReason = "Workflow interrupted by user.";

	startRun(): void {
		this.runStartedAt = Date.now();
		this.paused = false;
		this.stopRequested = false;
		this.stopReason = "Workflow interrupted by user.";
		this.currentHandle = undefined;
	}

	finishRun(): void {
		this.currentHandle = undefined;
		this.runStartedAt = undefined;
		this.paused = false;
		this.stopRequested = false;
		this.stopReason = "Workflow interrupted by user.";
	}

	attachProcess(handle: ControlledStageProcessHandle): void {
		this.currentHandle = handle;
		if (this.stopRequested) {
			handle.stop(this.stopReason);
			return;
		}
		if (this.paused) {
			handle.pause();
		}
	}

	detachProcess(handle: ControlledStageProcessHandle): void {
		if (this.currentHandle === handle) {
			this.currentHandle = undefined;
		}
	}

	isRunActive(): boolean {
		return this.runStartedAt !== undefined;
	}

	isPaused(): boolean {
		return this.paused;
	}

	isStopRequested(): boolean {
		return this.stopRequested;
	}

	getStopReason(): string {
		return this.stopReason;
	}

	getElapsedMs(): number {
		if (this.runStartedAt === undefined) return 0;
		return Math.max(0, Date.now() - this.runStartedAt);
	}

	ensureNotStopped(): void {
		if (this.stopRequested) {
			throw new Error(this.stopReason);
		}
	}

	togglePause(): { paused: boolean; message: string } {
		if (!this.isRunActive()) {
			return { paused: false, message: "No idea-refinement workflow is currently running." };
		}
		if (this.stopRequested) {
			return { paused: this.paused, message: this.stopReason };
		}

		this.paused = !this.paused;
		if (this.currentHandle) {
			if (this.paused) this.currentHandle.pause();
			else this.currentHandle.resume();
		}

		return {
			paused: this.paused,
			message: this.paused ? "Idea-refinement workflow paused." : "Idea-refinement workflow resumed.",
		};
	}

	requestStop(reason = "Workflow interrupted by user."): { message: string } {
		if (!this.isRunActive()) {
			return { message: "No idea-refinement workflow is currently running." };
		}
		if (this.stopRequested) {
			return { message: this.stopReason };
		}

		this.stopRequested = true;
		this.stopReason = reason;
		this.currentHandle?.stop(reason);
		return { message: reason };
	}
}
