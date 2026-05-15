export const LOOP_COUNT_SOFT_CONFIRM_THRESHOLD = 20;
export const LOOP_COUNT_HARD_LIMIT = 1000;

export function assertValidLoopCount(value: number, fieldName = "loop count"): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > LOOP_COUNT_HARD_LIMIT) {
		throw new Error(`${fieldName} must be an integer between 1 and ${LOOP_COUNT_HARD_LIMIT}.`);
	}
}
