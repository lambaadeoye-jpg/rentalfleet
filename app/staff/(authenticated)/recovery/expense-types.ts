export const EXPENSE_TYPES = ["toll", "ticket", "cleaning", "fuel", "storage", "impound", "locksmith", "transportation", "repair", "other"] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];
