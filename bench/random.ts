export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
	};
}

export function randomFromKey(...parts: number[]): number {
	const seed = parts.reduce((hash, part) => Math.imul(hash ^ part, 0x9e3779b1) >>> 0, 0x811c9dc5);
	return seededRandom(seed)();
}
