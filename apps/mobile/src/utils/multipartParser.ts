import { Predicate } from "effect";
// Mostly copied from this: https://github.com/apollographql/apollo-client/blob/356fcc9414286988d884e26dffafaf4d317d1b2d/src/link/http/parseAndCheckHttpResponse.ts#L16

export async function* parseMultipart(response: Response) {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("No reader found");
  }

  const decoder = new TextDecoder("utf-8");
  const contentType = response.headers?.get("content-type");
  const delimiter = "boundary=";

  // parse boundary value and ignore any subsequent name/value pairs after ;
  // https://www.rfc-editor.org/rfc/rfc9110.html#name-parameters
  // e.g. multipart/mixed;boundary="graphql";deferSpec=20220824
  // if no boundary is specified, default to -
  const boundaryVal = contentType?.includes(delimiter)
    ? contentType
        ?.substring(contentType?.indexOf(delimiter) + delimiter.length)
        .replace(/['"]/g, "")
        .replace(/;(.*)/gm, "")
        .trim()
    : "-";

  const boundary = `\r\n--${boundaryVal}`;
  let buffer = "";
  let running = true;

  while (running) {
    const { value, done } = await reader.read();
    const chunk = Predicate.isString(value) ? value : decoder.decode(value);
    const searchFrom = buffer.length - boundary.length + 1;
    running = !done;
    buffer += chunk;
    let bi = buffer.indexOf(boundary, searchFrom);

    while (bi > -1) {
      let message: string;
      [message, buffer] = [
        buffer.slice(0, bi),
        buffer.slice(bi + boundary.length),
      ];
      const i = message.indexOf("\r\n\r\n");
      const headers = parseHeaders(message.slice(0, i));
      const contentType = headers["content-type"];
      if (!contentType?.toLowerCase().includes("application/json")) {
        throw new Error(
          "Unsupported patch content type: application/json is required.",
        );
      }

      // nb: Technically you'd want to slice off the beginning "\r\n" but since
      // this is going to be `JSON.parse`d there is no need.
      const body = message.slice(i);

      if (body) {
        const result = parseJsonBody(response, body);
        if (
          Object.keys(result).length > 1 ||
          "data" in result ||
          "incremental" in result ||
          "errors" in result
        ) {
          // for the last chunk with only `hasNext: false`
          // we don't need to call observer.next as there is no data/errors
          if (result.data) {
            yield result;
          } else if (result.incremental) {
            for (const chunk of result.incremental) {
              yield chunk;
            }
          }
        } else if (
          // If the chunk contains only a "hasNext: false", we can call
          // observer.complete() immediately, by returning from the iterator.
          Object.keys(result).length === 1 &&
          "hasNext" in result &&
          !result.hasNext
        ) {
          return;
        }
      }
      bi = buffer.indexOf(boundary);
    }
  }
}

export function parseHeaders(headerText: string) {
  const headers: Record<string, string> = {};

  headerText.split("\n").forEach((line) => {
    const i = line.indexOf(":");
    if (i > -1) {
      // normalize headers to lowercase
      const name = line.slice(0, i).trim().toLowerCase();
      const value = line.slice(i + 1).trim();
      headers[name] = value;
    }
  });

  return headers;
}

export class GraphQLError extends Error {
  response: Response;
  statusCode: number;
  result: any;

  constructor(response: Response, result: any, message: string) {
    super(message);
    this.name = "GraphQLError";
    this.response = response;
    this.statusCode = response.status;
    this.result = result;
  }
}

export function parseJsonBody(response: Response, bodyText: string) {
  if (response.status >= 300) {
    // Network error
    const getResult = (): unknown => {
      try {
        return JSON.parse(bodyText);
      } catch (err) {
        console.error(err);
        return bodyText;
      }
    };

    throw new GraphQLError(
      response,
      getResult(),
      `Response not successful: Received status code ${response.status}`,
    );
  }

  return JSON.parse(bodyText);
}
