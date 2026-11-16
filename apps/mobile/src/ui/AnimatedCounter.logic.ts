export function counterCharacters(formatted: string) {
  // Keep currency marks and other non-digit text intact, including graphemes.
  const characters = formatted.match(/\d|\D+/g) ?? [];
  let place = characters.filter((character) => /\d/.test(character)).length;
  const firstDigit = characters.findIndex((character) => /\d/.test(character));

  return characters.map((character, index) => {
    const isDigit = /\d/.test(character);
    if (isDigit) {
      place -= 1;
    }
    return {
      character,
      isDigit,
      key: isDigit
        ? `digit-${place}`
        : index < firstDigit
          ? `prefix-${character}-${index}`
          : `mark-${place}-${character}`,
    };
  });
}

/** Continue from the visible face, including halfway through an earlier roll. */
export function nextWheelPosition(
  current: number,
  digit: number,
  direction: number,
) {
  "worklet";
  const face = ((current % 10) + 10) % 10;
  const distance =
    direction < 0 ? -((face - digit + 10) % 10) : (digit - face + 10) % 10;
  return current + distance;
}
