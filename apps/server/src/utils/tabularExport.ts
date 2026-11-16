import { omitUndefined } from "@/utils/omitUndefined";
export type TabularExportFormat = "CSV" | "PDF";

export interface SectionedTabularExportSection {
	details?: string[];
	emptyMessage?: string;
	headers: string[];
	rows: string[][];
	subtitle?: string;
	title: string;
}

const normalizeDisplayText = (value: string): string =>
	value.replaceAll("&#13;", " ").replaceAll("&#10;", " ").replaceAll("&nbsp;", " ");

const sanitizeCell = (value: string, maxLength: number): string =>
	normalizeDisplayText(value).replaceAll(/\s+/gu, " ").trim().slice(0, maxLength);

const toCsvCell = (value: string): string => {
	const normalized = normalizeDisplayText(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
	const escaped = normalized.replaceAll('"', '""');
	return `"${escaped}"`;
};

const createCsv = (params: { details?: string[]; headers: string[]; rows: string[][] }): Buffer => {
	const detailLines = (params.details ?? []).map((detail) => `# ${detail}`);
	if (detailLines.length > 0) {
		detailLines.push("");
	}
	const headerLine = params.headers.map((header) => toCsvCell(header)).join(",");
	const rowLines = params.rows.map((row) => row.map((cell) => toCsvCell(cell ?? "")).join(","));
	return Buffer.from([...detailLines, headerLine, ...rowLines].join("\n"), "utf8");
};

const createSectionedCsv = (params: {
	details?: string[];
	sections: SectionedTabularExportSection[];
	subtitle?: string;
	title: string;
}): Buffer => {
	const lines: string[] = [
		`# ${params.title}`,
		...(params.subtitle ? [`# ${params.subtitle}`] : []),
		...(params.details ?? []).map((detail) => `# ${detail}`),
	];
	if (lines.length > 0) {
		lines.push("");
	}

	params.sections.forEach((section, index) => {
		lines.push(toCsvCell(section.title));
		if (section.subtitle) {
			lines.push(toCsvCell(section.subtitle));
		}
		for (const detail of section.details ?? []) {
			lines.push(toCsvCell(detail));
		}
		lines.push(section.headers.map((header) => toCsvCell(header)).join(","));
		if (section.rows.length > 0) {
			lines.push(...section.rows.map((row) => row.map((cell) => toCsvCell(cell ?? "")).join(",")));
		} else if (section.emptyMessage) {
			lines.push(toCsvCell(section.emptyMessage));
		}
		if (index < params.sections.length - 1) {
			lines.push("");
		}
	});

	return Buffer.from(lines.join("\n"), "utf8");
};

const loadPdfLib = async () =>
	(await import("pdf-lib")) as {
		PDFDocument: {
			create: () => Promise<{
				addPage: (size?: [number, number]) => {
					drawText: (
						text: string,
						opts: {
							x: number;
							y: number;
							color?: unknown;
							font: unknown;
							size: number;
						},
					) => void;
					getHeight: () => number;
				};
				embedFont: (fontName: string) => Promise<unknown>;
				save: () => Promise<Uint8Array>;
			}>;
		};
		StandardFonts: {
			Helvetica: string;
			HelveticaBold: string;
		};
		rgb: (r: number, g: number, b: number) => unknown;
	};

const createPdf = async (params: {
	details?: string[];
	title: string;
	subtitle: string;
	headers: string[];
	rows: string[][];
}): Promise<Buffer> => {
	const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
	const pdfDoc = await PDFDocument.create();
	const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

	let page = pdfDoc.addPage([612, 792]);
	const margin = 40;
	const rowHeight = 18;
	const pageWidth = 612;
	const contentWidth = pageWidth - margin * 2;
	const columnWidth = contentWidth / params.headers.length;
	let y = page.getHeight() - margin;

	const drawHeaderRow = () => {
		params.headers.forEach((header, index) => {
			page.drawText(sanitizeCell(header, 60), {
				font: boldFont,
				size: 11,
				x: margin + index * columnWidth,
				y,
			});
		});
		y -= rowHeight;
	};

	page.drawText(sanitizeCell(params.title, 120), {
		color: rgb(0, 0, 0),
		font: boldFont,
		size: 16,
		x: margin,
		y,
	});
	y -= 22;

	page.drawText(sanitizeCell(params.subtitle, 200), {
		color: rgb(0.25, 0.25, 0.25),
		font: regularFont,
		size: 10,
		x: margin,
		y,
	});
	y -= 20;
	for (const detail of params.details ?? []) {
		page.drawText(sanitizeCell(detail, 200), {
			color: rgb(0.25, 0.25, 0.25),
			font: regularFont,
			size: 10,
			x: margin,
			y,
		});
		y -= 14;
	}
	y -= 6;
	drawHeaderRow();

	for (const row of params.rows) {
		if (y <= margin + rowHeight) {
			page = pdfDoc.addPage([612, 792]);
			y = page.getHeight() - margin;
			drawHeaderRow();
		}

		for (let index = 0; index < row.length; index += 1) {
			const cell = row[index] ?? "";
			page.drawText(sanitizeCell(cell, 45), {
				font: regularFont,
				size: 10,
				x: margin + index * columnWidth,
				y,
			});
		}

		y -= rowHeight;
	}

	const bytes = await pdfDoc.save();
	return Buffer.from(bytes);
};

const createSectionedPdf = async (params: {
	details?: string[];
	sections: SectionedTabularExportSection[];
	subtitle?: string;
	title: string;
}): Promise<Buffer> => {
	const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
	const pdfDoc = await PDFDocument.create();
	const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

	let page = pdfDoc.addPage([612, 792]);
	const margin = 40;
	const rowHeight = 18;
	const pageWidth = 612;
	const contentWidth = pageWidth - margin * 2;
	let y = page.getHeight() - margin;

	const ensureSpace = (requiredHeight: number) => {
		if (y > margin + requiredHeight) {
			return;
		}
		page = pdfDoc.addPage([612, 792]);
		y = page.getHeight() - margin;
	};

	const drawTextLine = (
		text: string,
		options: { color?: unknown; font: unknown; size: number },
	) => {
		page.drawText(sanitizeCell(text, 200), {
			x: margin,
			y,
			...options,
		});
	};

	drawTextLine(params.title, {
		color: rgb(0, 0, 0),
		font: boldFont,
		size: 16,
	});
	y -= 22;

	if (params.subtitle) {
		drawTextLine(params.subtitle, {
			color: rgb(0.25, 0.25, 0.25),
			font: regularFont,
			size: 10,
		});
		y -= 20;
	}

	for (const detail of params.details ?? []) {
		drawTextLine(detail, {
			color: rgb(0.25, 0.25, 0.25),
			font: regularFont,
			size: 10,
		});
		y -= 14;
	}
	y -= 8;

	for (const [sectionIndex, section] of params.sections.entries()) {
		if (sectionIndex > 0) {
			page = pdfDoc.addPage([612, 792]);
			y = page.getHeight() - margin;
		} else {
			ensureSpace(90);
		}
		drawTextLine(section.title, {
			color: rgb(0, 0, 0),
			font: boldFont,
			size: 13,
		});
		y -= 18;

		if (section.subtitle) {
			drawTextLine(section.subtitle, {
				color: rgb(0.25, 0.25, 0.25),
				font: regularFont,
				size: 10,
			});
			y -= 16;
		}

		for (const detail of section.details ?? []) {
			drawTextLine(detail, {
				color: rgb(0.25, 0.25, 0.25),
				font: regularFont,
				size: 10,
			});
			y -= 14;
		}

		const columnWidth = contentWidth / section.headers.length;
		for (const [index, header] of section.headers.entries()) {
			page.drawText(sanitizeCell(header, 60), {
				font: boldFont,
				size: 11,
				x: margin + index * columnWidth,
				y,
			});
		}
		y -= rowHeight;

		if (section.rows.length === 0 && section.emptyMessage) {
			drawTextLine(section.emptyMessage, {
				color: rgb(0.25, 0.25, 0.25),
				font: regularFont,
				size: 10,
			});
			y -= rowHeight;
		} else {
			for (const row of section.rows) {
				ensureSpace(rowHeight * 2);
				for (let index = 0; index < row.length; index += 1) {
					const cell = row[index] ?? "";
					page.drawText(sanitizeCell(cell, 55), {
						font: regularFont,
						size: 10,
						x: margin + index * columnWidth,
						y,
					});
				}
				y -= rowHeight;
			}
		}

		y -= 12;
	}

	const bytes = await pdfDoc.save();
	return Buffer.from(bytes);
};

export const getTabularExportFileExtension = (format: TabularExportFormat) =>
	format === "CSV" ? "csv" : "pdf";

export const getTabularExportContentType = (format: TabularExportFormat) =>
	format === "CSV" ? "text/csv; charset=utf-8" : "application/pdf";

export const createTabularExportFile = (params: {
	details?: string[];
	format: TabularExportFormat;
	headers: string[];
	rows: string[][];
	subtitle: string;
	title: string;
}): Promise<Buffer> => {
	if (params.format === "CSV") {
		return Promise.resolve(
			createCsv(
				omitUndefined({
					headers: params.headers,
					rows: params.rows,
					details: params.details || undefined,
				}),
			),
		);
	}

	return createPdf(
		omitUndefined({
			title: params.title,
			subtitle: params.subtitle,
			headers: params.headers,
			rows: params.rows,
			details: params.details || undefined,
		}),
	);
};

export const createSectionedTabularExportFile = (params: {
	details?: string[];
	format: TabularExportFormat;
	sections: SectionedTabularExportSection[];
	subtitle?: string;
	title: string;
}): Promise<Buffer> => {
	if (params.format === "CSV") {
		return Promise.resolve(
			createSectionedCsv(
				omitUndefined({
					sections: params.sections,
					title: params.title,
					subtitle: params.subtitle || undefined,
					details: params.details || undefined,
				}),
			),
		);
	}

	return createSectionedPdf(
		omitUndefined({
			sections: params.sections,
			title: params.title,
			subtitle: params.subtitle || undefined,
			details: params.details || undefined,
		}),
	);
};
