import { format, parseISO } from "date-fns";
import { Predicate, Schema } from "effect";

import type { CCBRequestType, CCBResponse } from "@hccnj/ccb";

type ValidatedGivingData = CCBResponse<CCBRequestType.GET_GIVING>;

const CCB_TEXT_FIELD = "_text";
type RawPaymentType = string | { readonly [CCB_TEXT_FIELD]?: string | undefined } | undefined;
const normalizePaymentType = (v: RawPaymentType): string | undefined | null =>
	Predicate.isString(v) ? v : v?.[CCB_TEXT_FIELD];

const toArray = <T>(value: T | readonly T[] | undefined): T[] => {
	if (!value) {
		return [];
	}
	return Array.isArray(value) ? [...value] : [value as T];
};

const TaxFlagSchema = Schema.Union([Schema.Boolean, Schema.Literals(["true", "false"])]);
const TaxDeductibleSchema = Schema.Union([
	TaxFlagSchema,
	Schema.Struct({ _text: TaxFlagSchema }),
	Schema.Struct({ text: TaxFlagSchema }),
]);
const AccountSchema = Schema.Struct({ text: Schema.optional(Schema.String) });
const DetailSchema = Schema.Struct({
	id: Schema.optional(Schema.String),
	amount: Schema.Union([Schema.String, Schema.Number]),
	coa: Schema.optional(AccountSchema),
	tax_deductible: Schema.optional(TaxDeductibleSchema),
});

function normalizeTaxDeductible(value: typeof TaxDeductibleSchema.Type | undefined): boolean {
	if (value === undefined) {
		return true;
	}
	if (Predicate.isBoolean(value)) {
		return value;
	}
	if (Predicate.isString(value)) {
		return value === "true";
	}
	const flag = "_text" in value ? value._text : value.text;
	return flag === true || flag === "true";
}

export interface UserGiving {
	giving: {
		amount: number;
		date: string;
		name: string;
		transactionId: string;
		taxDeductible: boolean;
		paymentType?: string;
		campus: string;
		campusId: string;
	}[];
	total: number;
	numberOfGiving: number;
	ccbId: string;
}

/**
 * CCB's yearly window filters on modification date, so it also returns older gifts edited
 * during `year`; only gifts dated in `year` belong to it.
 */
export function parseGiving(
	givingData: ValidatedGivingData,
	ccbId: string,
	year: number,
): UserGiving {
	const transactions = toArray(givingData?.transactions?.transaction);
	const giving = transactions
		.filter((transaction) => transaction.individual?.id === ccbId)
		.map((transaction) => ({
			transaction,
			date: format(parseISO(transaction.date), "yyyy-MM-dd"),
		}))
		.filter(({ date }) => date.startsWith(`${year}-`))
		.flatMap(({ transaction, date }) =>
			toArray<unknown>(transaction.transaction_details?.transaction_detail).map((rawDetail) => {
				const detail = Schema.decodeUnknownSync(DetailSchema)(rawDetail);
				const amount = Number(detail.amount);
				if (
					!Number.isFinite(amount) ||
					(Predicate.isString(detail.amount) && detail.amount.trim() === "")
				) {
					throw new Error("Invalid amount in giving transaction");
				}
				return {
					amount,
					date,
					name: detail.coa?.text || "Giving",
					transactionId: detail.id || "N/A",
					taxDeductible: normalizeTaxDeductible(detail.tax_deductible),
					paymentType: normalizePaymentType(transaction.payment_type) as string,
					campus: transaction.campus?.text,
					campusId: transaction.campus?.id,
				};
			}),
		)
		.toSorted((a, b) => b.date.localeCompare(a.date));
	const total = giving.reduce((acc, curr) => acc + curr.amount, 0);
	return { giving, total, numberOfGiving: giving.length, ccbId };
}
