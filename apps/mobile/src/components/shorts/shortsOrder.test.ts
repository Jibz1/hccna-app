import { describe, expect, it } from "vitest";

import { appendCycle, orderShorts } from "@/components/shorts/shortsOrder";

type TestShort = { readonly id: string; readonly curated: boolean };

const short = (id: string, curated = false): TestShort => ({ id, curated });

/** Small deterministic generator so shuffles repeat between runs. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe("orderShorts", () => {
  it("puts every curated short before every other short", () => {
    const input = [
      short("o1"),
      short("c1", true),
      short("o2"),
      short("o3"),
      short("c2", true),
      short("o4"),
      short("c3", true),
      short("o5"),
    ];

    const ordered = orderShorts(input, seeded(7));

    expect(ordered.slice(0, 3).every((item) => item.curated)).toBe(true);
    expect(ordered.slice(3).some((item) => item.curated)).toBe(false);
    expect(ordered.map((item) => item.id).toSorted()).toEqual(
      input.map((item) => item.id).toSorted(),
    );
  });

  it("shuffles each group", () => {
    const input = [short("a"), short("b"), short("c"), short("d")];

    const ordered = orderShorts(input, () => 0);

    expect(ordered.map((item) => item.id)).toEqual(["b", "c", "d", "a"]);
  });

  it("returns [] for no shorts", () => {
    expect(orderShorts([])).toEqual([]);
  });

  it("leaves the input untouched", () => {
    const input = [short("a"), short("b"), short("c")];

    orderShorts(input, () => 0);

    expect(input.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("appendCycle", () => {
  it("appends a full pass with cycle-scoped keys", () => {
    const shorts = [short("a"), short("b"), short("c")];

    const first = appendCycle([], shorts, 0, seeded(1));
    const second = appendCycle(first, shorts, 1, seeded(2));

    expect(first).toHaveLength(3);
    expect(first.every((entry) => entry.key.startsWith("0:"))).toBe(true);
    expect(second).toHaveLength(6);
    expect(new Set(second.map((entry) => entry.key)).size).toBe(6);
    expect(second.slice(0, 3)).toEqual(first);
  });

  it("does not repeat the last short across a pass boundary", () => {
    const shorts = [short("a"), short("b"), short("c")];

    for (let seed = 1; seed <= 50; seed += 1) {
      const random = seeded(seed);
      const entries = appendCycle(
        appendCycle([], shorts, 0, random),
        shorts,
        1,
        random,
      );
      expect(entries[2]?.short.id).not.toBe(entries[3]?.short.id);
    }
  });

  it("keeps curated shorts first when avoiding a boundary repeat", () => {
    const shorts = [short("c1", true), short("c2", true)];

    for (let seed = 1; seed <= 50; seed += 1) {
      const random = seeded(seed);
      const entries = appendCycle(
        appendCycle([], shorts, 0, random),
        shorts,
        1,
        random,
      );
      expect(entries[1]?.short.id).not.toBe(entries[2]?.short.id);
    }
  });

  it("cycles a single short without duplicate keys", () => {
    const shorts = [short("x")];

    let entries = appendCycle([], shorts, 0);
    entries = appendCycle(entries, shorts, 1);
    entries = appendCycle(entries, shorts, 2);

    expect(entries.map((entry) => entry.key)).toEqual(["0:x", "1:x", "2:x"]);
  });

  it("appends nothing when there are no shorts", () => {
    expect(appendCycle([], [], 0)).toEqual([]);
  });
});
