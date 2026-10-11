export type Hap<T> = {
	value: T;
	duration: { valueOf(): number };
	whole?: { begin: { valueOf(): number } };
};

export type TriggerCallback<T> = (
	hap: Hap<T>,
	currentTime: number,
	cps: number,
	targetTime: number
) => void;

export interface Pattern<T> {
	fmap<U>(transform: (value: T) => U): Pattern<U>;
	withValue<U>(transform: (value: T) => U): Pattern<U>;
	onTrigger(callback: TriggerCallback<T>, dominant?: boolean): Pattern<T>;
	seek(seconds: number | Pattern<number>): Pattern<T>;
}

export type StrudelScope = {
	register<T, A>(name: string, method: (argument: A, pattern: Pattern<T>) => Pattern<T>): void;
	reify<T>(value: T | Pattern<T>): Pattern<T>;
	samples(sampleMap: Record<string, string | string[]>): Promise<void>;
	loadBuffer(url: string, context: BaseAudioContext, label?: string): Promise<AudioBuffer>;
	getAudioContext(): AudioContext;
	superdough(
		value: Record<string, unknown>,
		time: number,
		durationSeconds: number,
		cps?: number,
		cycle?: number
	): Promise<unknown>;
};

export type StrudelEditorElement = HTMLElement & {
	editor: {
		prebaked: Promise<unknown>;
		changeSetting(name: string, value: unknown): void;
	};
};

const REQUIRED_FUNCTIONS: (keyof StrudelScope)[] = [
	"register",
	"reify",
	"samples",
	"loadBuffer",
	"getAudioContext",
	"superdough"
];

export function strudelScope(): StrudelScope {
	const scope = globalThis as unknown as Partial<StrudelScope>;
	const missing = REQUIRED_FUNCTIONS.filter((name) => typeof scope[name] !== "function");
	if (missing.length > 0) {
		throw new Error(
			`Strudel functions are not loaded: ${missing.join(", ")}. Wait for the editor to finish prebake.`
		);
	}
	return scope as StrudelScope;
}
