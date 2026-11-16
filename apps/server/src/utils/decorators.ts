export function memo() {
	const cache = new WeakMap<object, Map<string, unknown>>();

	return function (
		_target: Parameters<MethodDecorator>[0],
		propertyKey: string,
		descriptor: PropertyDescriptor,
	) {
		const originalMethod = descriptor.value;

		descriptor.value = function (...args: unknown[]) {
			let instanceCache = cache.get(this);
			if (!instanceCache) {
				instanceCache = new Map();
				cache.set(this, instanceCache);
			}

			if (!instanceCache.has(propertyKey)) {
				instanceCache.set(propertyKey, originalMethod.bind(this)(...args));
			}

			return instanceCache.get(propertyKey);
		};
	};
}
