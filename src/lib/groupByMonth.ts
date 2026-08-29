import { format } from "date-fns";

export type MonthGroup<T> = { key: string; label: string; items: T[] };

/**
 * Groups items by month (newest month first), using the given item's
 * timestamp. `getDate` may return a Date, ISO string, or epoch ms.
 * Items within each month are also sorted newest first, regardless of
 * the order they were passed in.
 */
export function groupByMonth<T>(
  items: T[],
  getDate: (item: T) => Date | string | number
): MonthGroup<T>[] {
  const groups = new Map<string, MonthGroup<T>>();

  for (const item of items) {
    const date = new Date(getDate(item));
    const key = format(date, "yyyy-MM");
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { key, label: format(date, "MMMM yyyy"), items: [item] });
    }
  }

  for (const group of groups.values()) {
    group.items.sort(
      (a, b) => new Date(getDate(b)).getTime() - new Date(getDate(a)).getTime()
    );
  }

  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}
