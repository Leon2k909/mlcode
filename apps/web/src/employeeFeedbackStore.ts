import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createMemoryStorage, resolveStorage, type StateStorage } from "./lib/storage";

const EMPLOYEE_FEEDBACK_STORAGE_KEY = "mlcode:employee-feedback:v1";
const MAX_EMPLOYEE_FEEDBACK_RECORDS = 500;

export interface EmployeeFeedbackRecord {
  readonly recordedAt: string;
}

interface EmployeeFeedbackState {
  readonly negativeByMessageKey: Readonly<Record<string, EmployeeFeedbackRecord>>;
  readonly markNegative: (messageKey: string) => void;
}

function feedbackStorage(): StateStorage {
  if (typeof window === "undefined") return createMemoryStorage();
  try {
    return resolveStorage(window.localStorage);
  } catch {
    return createMemoryStorage();
  }
}

function trimRecords(
  records: Readonly<Record<string, EmployeeFeedbackRecord>>,
): Record<string, EmployeeFeedbackRecord> {
  const entries = Object.entries(records);
  if (entries.length <= MAX_EMPLOYEE_FEEDBACK_RECORDS) return { ...records };
  return Object.fromEntries(
    entries
      .toSorted(([, left], [, right]) => left.recordedAt.localeCompare(right.recordedAt))
      .slice(-MAX_EMPLOYEE_FEEDBACK_RECORDS),
  );
}

export const useEmployeeFeedbackStore = create<EmployeeFeedbackState>()(
  persist(
    (set) => ({
      negativeByMessageKey: {},
      markNegative: (messageKey) => {
        const normalizedKey = messageKey.trim();
        if (!normalizedKey) return;
        set((state) => {
          if (state.negativeByMessageKey[normalizedKey] !== undefined) return state;
          return {
            negativeByMessageKey: trimRecords({
              ...state.negativeByMessageKey,
              [normalizedKey]: { recordedAt: new Date().toISOString() },
            }),
          };
        });
      },
    }),
    {
      name: EMPLOYEE_FEEDBACK_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(feedbackStorage),
      partialize: (state) => ({ negativeByMessageKey: state.negativeByMessageKey }),
    },
  ),
);
