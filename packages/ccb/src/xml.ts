import { XMLBuilder, XMLParser } from "fast-xml-parser";

/**
 * Shared XML parser configured for CCB API responses.
 * Matches the exact config previously duplicated in CCBService, ccbCache, and ccbApi.
 */
const ccbXmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	parseAttributeValue: false,
	trimValues: true,
	textNodeName: "text",
});

/**
 * Shared XML builder for constructing CCB API POST payloads.
 */
const ccbXmlBuilder = new XMLBuilder({
	attributeNamePrefix: "@_",
	ignoreAttributes: false,
});

const MAX_XML_SIZE_BYTES = 1_048_576; // 1MB

export type CCBXmlInput = Parameters<XMLBuilder["build"]>[0];

/**
 * Parse a CCB XML response string, extracting the `.ccb_api.response` body.
 * Returns `undefined` if the response structure is missing.
 */
export function parseCCBXmlResponse(xmlText: string): unknown {
	const xmlSizeBytes = Buffer.byteLength(xmlText, "utf8");
	if (xmlSizeBytes > MAX_XML_SIZE_BYTES) {
		throw new Error(
			`[CCBClient] XML response too large: ${xmlSizeBytes} bytes (max: ${MAX_XML_SIZE_BYTES})`,
		);
	}

	const parsed = ccbXmlParser.parse(xmlText, {
		allowBooleanAttributes: true,
	});
	return parsed.ccb_api?.response;
}

/**
 * Build an XML body string from a JSON object, with XML declaration header.
 * Used for CCB POST requests that require XML file uploads.
 */
export function buildCCBXmlBody(jsonData: CCBXmlInput): string {
	const xmlBody = ccbXmlBuilder.build(jsonData);
	return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBody}`;
}
