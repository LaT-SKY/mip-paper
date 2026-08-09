import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonthCalendar } from '../src/month-calendar.mjs';

test('builds a Monday-first six-week leap February', () => {
  const model = buildMonthCalendar(new Date(2024, 1, 29, 12));
  assert.deepEqual(model.weekdays, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  assert.equal(model.days.length, 42);
  assert.deepEqual(model.days[0], { year: 2024, month: 1, day: 29, inCurrentMonth: false, isToday: false });
  assert.deepEqual(model.days[31], { year: 2024, month: 2, day: 29, inCurrentMonth: true, isToday: true });
});

test('fills January from the previous and next years', () => {
  const model = buildMonthCalendar(new Date(2027, 0, 15, 12));
  assert.deepEqual(model.days[0], { year: 2026, month: 12, day: 28, inCurrentMonth: false, isToday: false });
  assert.equal(model.days.filter((day) => day.isToday).length, 1);
  assert.equal(model.days.at(-1).year, 2027);
  assert.equal(model.days.at(-1).month, 2);
});

test('represents 28, 29, 30 and 31-day months exactly', () => {
  for (const [date, count] of [
    [new Date(2023, 1, 10, 12), 28],
    [new Date(2024, 1, 10, 12), 29],
    [new Date(2026, 3, 10, 12), 30],
    [new Date(2026, 0, 10, 12), 31],
  ]) {
    assert.equal(buildMonthCalendar(date).days.filter((day) => day.inCurrentMonth).length, count);
  }
});

test('aligns months that start on Monday or Sunday', () => {
  assert.deepEqual(buildMonthCalendar(new Date(2025, 8, 1, 12)).days[0], {
    year: 2025, month: 9, day: 1, inCurrentMonth: true, isToday: true,
  });
  assert.deepEqual(buildMonthCalendar(new Date(2025, 5, 1, 12)).days.slice(0, 7).map(({ day }) => day), [26, 27, 28, 29, 30, 31, 1]);
});

test('rejects invalid dates', () => {
  assert.throws(() => buildMonthCalendar(new Date(Number.NaN)), /now must be a valid Date/);
  assert.throws(() => buildMonthCalendar('2026-08-09'), /now must be a valid Date/);
});
