export type FeedEntry<T> = { readonly key: string; readonly short: T };

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }
  return result;
}

/** One full pass: curated shorts shuffled first, then the rest shuffled. */
export function orderShorts<T extends { readonly curated: boolean }>(
  shorts: readonly T[],
  random: () => number = Math.random,
): T[] {
  return [
    ...shuffled(
      shorts.filter((short) => short.curated),
      random,
    ),
    ...shuffled(
      shorts.filter((short) => !short.curated),
      random,
    ),
  ];
}

/**
 * Appends another full pass, so no short repeats until every one has played.
 * Keys are scoped by pass because the same short appears once per pass.
 */
export function appendCycle<
  T extends { readonly id: string; readonly curated: boolean },
>(
  entries: readonly FeedEntry<T>[],
  shorts: readonly T[],
  cycle: number,
  random: () => number = Math.random,
): FeedEntry<T>[] {
  const pass = orderShorts(shorts, random);
  const [first, second] = pass;
  // A new pass may open with the short that closed the previous one. That can
  // only happen when both are in the same group (curated shorts always precede
  // the rest), so swapping the first two keeps curated shorts in front.
  if (first && second && entries.at(-1)?.short.id === first.id) {
    pass[0] = second;
    pass[1] = first;
  }
  return [
    ...entries,
    ...pass.map((short) => ({ key: `${cycle}:${short.id}`, short })),
  ];
}
