/**
 * Generates a random integer between 1 and 100 (inclusive).
 *
 * Used as a contextual seed for the idea-refinement workflow.
 * The initial number defines the primary policy of DIRECTIVE.md:
 * - 1–80  → OPTIMIZATION
 * - 81–100 → CREATIVITY/EXPLORATION
 *
 * Each subsequent loop receives its own number as a variety seed.
 *
 * Implementation based on Mersenne Twister mixed with entropy from
 * the Web Crypto API (CSPRNG) to reduce predictability.
 */

const UINT32_MOD = 0x1_0000_0000;
const SAFE_QUOTIENT_MASK = 0x1f_ffff; // 21 bits to keep the result within Number.MAX_SAFE_INTEGER.

/** Mersenne Twister (MT19937) implementation. */
class MersenneTwister {
	private readonly mt: Uint32Array;
	private index: number;

	constructor(seed: number = Date.now()) {
		this.mt = new Uint32Array(624);
		this.index = 0;
		this.mt[0] = seed >>> 0;
		for (let i = 1; i < 624; i++) {
			this.mt[i] = (1812433253 * (this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) + i) >>> 0;
		}
	}

	/** Extracts the next unsigned 32-bit integer from the sequence. */
	extractNumber(): number {
		if (this.index === 0) {
			this.generateNumbers();
		}

		let y = this.mt[this.index];
		y ^= y >>> 11;
		y ^= (y << 7) & 0x9d2c5680;
		y ^= (y << 15) & 0xefc60000;
		y ^= y >>> 18;

		this.index = (this.index + 1) % 624;
		return y >>> 0;
	}

	/** Generates the next round of numbers (tempering). */
	private generateNumbers(): void {
		for (let i = 0; i < 624; i++) {
			const y = (this.mt[i] & 0x80000000) + (this.mt[(i + 1) % 624] & 0x7fffffff);
			this.mt[i] = this.mt[(i + 397) % 624] ^ (y >>> 1);
			if (y % 2 !== 0) {
				this.mt[i] ^= 0x9908b0df;
			}
		}
	}

	/** Returns a decimal number between 0 (inclusive) and 1 (exclusive). */
	random(): number {
		return this.extractNumber() / UINT32_MOD;
	}
}

/**
 * Generates a random number between 1 and 100 using modulo 100,
 * combining Mersenne Twister with cryptographic entropy from the environment.
 */
export function generateRandomNumber(): number {
	const seed = Date.now();
	const mt = new MersenneTwister(seed);
	const mtValue = mt.extractNumber();

	const randomBuffer = new Uint32Array(1);
	globalThis.crypto.getRandomValues(randomBuffer);

	const quotient = randomBuffer[0] & SAFE_QUOTIENT_MASK;
	return ((quotient * UINT32_MOD + mtValue) % 100) + 1;
}
