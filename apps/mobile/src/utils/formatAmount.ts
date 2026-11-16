export const formatCurrency = (amount: number | null | undefined): string => {
  if (amount == null || !Number.isFinite(amount)) {
    return "$0";
  }
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};
