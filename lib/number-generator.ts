/**
 * Generates a cryptographically secure random integer between 1 and 100 (inclusive).
 *
 * Uses exclusively the Web Crypto API (CSPRNG) for true non-deterministic randomness.
 * No Mersenne Twister, no Date.now() seed — every call is independent and unpredictable.
 *
 * Used as a contextual seed for the idea-refinement workflow.
 * The initial number defines the primary policy of DIRECTIVE.md:
 * - 1–80  → OPTIMIZATION
 * - 81–100 → CREATIVITY/EXPLORATION
 *
 * Each subsequent loop receives its own number as a variety seed.
 */

/**
 * Generates a random number between 1 and 100 using rejection sampling
 * to eliminate modulo bias entirely.
 */
export function generateRandomNumber(): number {
	// 2^32 / 100 = 42949672.96, so floor = 42949672
	// We accept values < 42949672 * 100 = 4294967200
	// This eliminates the bias that would come from 2^32 not being divisible by 100.
	const UNBIASED_LIMIT = Math.floor(0x1_0000_0000 / 100) * 100; // 4294967200
	const buffer = new Uint32Array(1);
	let value: number;
	do {
		globalThis.crypto.getRandomValues(buffer);
		value = buffer[0];
	} while (value >= UNBIASED_LIMIT);
	return (value % 100) + 1;
}
