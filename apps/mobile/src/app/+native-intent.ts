export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  // Preserve the source so the catch-all can send incoming links Home while
  // still showing a useful recovery screen for navigation within the app.
  const hashIndex = path.indexOf("#");
  const pathname = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : path.slice(hashIndex);
  const separator = pathname.includes("?") ? "&" : "?";

  return `${pathname}${separator}incomingLink=1${hash}`;
}
