export const WEEKDAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

export function buildMonthCalendar(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const firstDay = new Date(year, monthIndex, 1, 12);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - mondayOffset, 12);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12);
    return Object.freeze({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === monthIndex,
      isToday: date.getFullYear() === year
        && date.getMonth() === monthIndex
        && date.getDate() === now.getDate(),
    });
  });
  return Object.freeze({ year, month: monthIndex + 1, weekdays: WEEKDAYS, days: Object.freeze(days) });
}
