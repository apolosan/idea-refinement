/**
 * Gera um número inteiro aleatório entre 1 e 100 (inclusive).
 *
 * Usado como semente contextual para o workflow de refinamento de ideias.
 * O número inicial define a política principal da DIRECTIVE.md:
 * - 1–80  → OPTIMIZATION
 * - 81–100 → CREATIVITY/EXPLORATION
 *
 * Cada loop subsequente recebe seu próprio número como semente de variedade.
 *
 * Implementação baseada em Mersenne Twister misturado com entropia da
 * Web Crypto API (CSPRNG) para reduzir previsibilidade.
 */

const UINT32_MOD = 0x1_0000_0000;
const SAFE_QUOTIENT_MASK = 0x1f_ffff; // 21 bits para manter o resultado em Number.MAX_SAFE_INTEGER.

/** Implementação do algoritmo Mersenne Twister (MT19937). */
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

	/** Extrai o próximo número inteiro sem sinal de 32 bits da sequência. */
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

	/** Gera a próxima rodada de números (temperamento). */
	private generateNumbers(): void {
		for (let i = 0; i < 624; i++) {
			const y = (this.mt[i] & 0x80000000) + (this.mt[(i + 1) % 624] & 0x7fffffff);
			this.mt[i] = this.mt[(i + 397) % 624] ^ (y >>> 1);
			if (y % 2 !== 0) {
				this.mt[i] ^= 0x9908b0df;
			}
		}
	}

	/** Retorna um número decimal entre 0 (inclusive) e 1 (exclusivo). */
	random(): number {
		return this.extractNumber() / UINT32_MOD;
	}
}

/**
 * Gera um número aleatório entre 1 e 100 usando o resto da divisão por 100,
 * combinando Mersenne Twister com entropia criptográfica do ambiente.
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
