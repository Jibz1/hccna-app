import { type GraphQLResolveInfo } from "graphql";

export class PathContext<T = unknown> {
	#caches = new Map<
		keyof T,
		{
			path: string;
			value: T[keyof T];
		}[]
	>();

	set<K extends keyof T>(info: GraphQLResolveInfo, key: K, value: T[K]) {
		if (!this.#caches.has(key)) {
			this.#caches.set(key, []);
		}

		const path = getPath(info);

		const cache = this.#caches.get(key)!;

		cache.push({
			path,
			value,
		});
	}

	get<K extends keyof T>(info: GraphQLResolveInfo, key: K): T[K] | null {
		const cache = this.#caches.get(key);
		if (!cache) {
			return null;
		}
		const path = getPath(info);

		let closestEntry:
			| {
					path: string;
					value: T[keyof T];
			  }
			| undefined = undefined;

		for (const entry of cache) {
			if (
				path.startsWith(entry.path) &&
				(!closestEntry || entry.path.length > closestEntry.path.length)
			) {
				closestEntry = entry;
			}
		}

		return closestEntry?.value as T[K] | null;
	}
}

export function getPath(info: GraphQLResolveInfo) {
	let current = info.path;

	let path = String(current.key);

	while (current.prev) {
		path = `${current.prev.key}.${path}`;
		current = current.prev;
	}

	return path;
}
