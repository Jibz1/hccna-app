import { useAsyncMutation } from "@/hooks/useAsyncMutation";
import { shareFile } from "@/utils/shareFile";
import { writeFile } from "@/utils/writeFile";

export type YearGivingData = {
  year?: number | null;
  giving?:
    | readonly {
        name?: string | null;
        amount?: number | null;
        date?: string | null;
        paymentType?: string | null;
        taxDeductible?: boolean | null;
        campus?: string | null;
        campusId?: string | null;
        transactionId?: string | null;
      }[]
    | null;
  total?: number | null;
};

function toCSV(
  data: Record<string, string | number | boolean | null | undefined>[],
): string {
  if (data.length === 0) {
    return "";
  }
  const headers = Object.keys(data[0]).join(",");
  const rows = data.map((row) =>
    Object.values(row)
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [headers, ...rows].join("\r\n");
}

export function useExportYearGiving(
  yearData: YearGivingData | null | undefined,
) {
  return useAsyncMutation({
    mutationFn: async () => {
      const giving = yearData?.giving;
      if (!giving || !yearData?.year) {
        return;
      }
      const givingItems = giving.map((item) => ({
        name: item.name,
        amount: item.amount,
        date: item.date,
        paymentMethod: item.paymentType,
        taxDeductible: item.taxDeductible,
        campus: item.campus,
        campusId: item.campusId,
        transactionId: item.transactionId,
      }));

      const exportRows = [
        ...givingItems,
        {
          name: "Total Yearly Giving",
          amount: yearData.total ?? "",
          date: "",
          paymentMethod: "",
          taxDeductible: "",
          campus: "",
          campusId: "",
          transactionId: "",
        },
      ];

      const csv = toCSV(exportRows);
      const fileUri = await writeFile(
        `giving-${yearData.year}-${new Date().toISOString()}.csv`,
        csv,
      );
      await shareFile(fileUri);
    },
  });
}
