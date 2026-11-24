/** Default seed shared by all seed generators (Req 7.7). */
export const DEFAULT_SEED = 20240601;

/**
 * Create a deterministic pseudo-random generator (mulberry32).
 * Returns a function yielding floats in [0, 1). The same seed gives the same sequence.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
