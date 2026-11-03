/*
 * Bounded form of rrule's iterator. The upstream callback runs only for
 * dates which survive all BY* filters, so it cannot bound empty rules. Keep
 * the upstream period algorithm intact and charge each candidate period
 * before evaluating its day set. This code derives from rrule.js by Jakub
 * Roztocil and Lars Schöning.
 *
 * Copyright 2010, Jakub Roztocil <jakub@roztocil.name> and Lars Schöning
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of the author nor the names of its contributors may be
 *    used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import { freqIsDailyOrGreater, Frequency, ParsedOptions } from 'rrule/dist/esm/types';
import { combine, fromOrdinal, MAXYEAR } from 'rrule/dist/esm/dateutil';
import Iterinfo from 'rrule/dist/esm/iterinfo/index';
import { buildTimeset } from 'rrule/dist/esm/parseoptions';
import { notEmpty, includes, isPresent } from 'rrule/dist/esm/helpers';
import { DateWithZone } from 'rrule/dist/esm/datewithzone';
import { buildPoslist } from 'rrule/dist/esm/iter/poslist';
import { DateTime, Time } from 'rrule/dist/esm/datetime';

export class RecurrencePeriodLimitError extends Error {
  constructor() {
    super('The recurrence requires too much work for this request.');
    this.name = 'RecurrencePeriodLimitError';
  }
}

interface ResultSink {
  accept(date: Date): boolean;
  getValue(): Date[];
}

/** Mirrors the rrule iterator and adds a bound before each candidate period. */
export function iterateRRuleBounded(
  options: ParsedOptions,
  result: ResultSink,
  visitPeriod: () => void,
  seekDate?: Date
): Date[] {
  const { dtstart, freq, interval, until, bysetpos } = options;
  let count = options.count;
  if (count === 0 || interval === 0) return result.getValue();

  const counterDate = DateTime.fromDate(dtstart);
  // Daily and weekly rules can be sought while retaining COUNT when the
  // occurrence ordinal has a closed form. Rules with additional calendar
  // filters stay on the bounded iterator because counting those matches needs
  // the full filter semantics.
  if (seekDate && (freq === Frequency.DAILY || freq === Frequency.WEEKLY)) {
    const target = DateTime.fromDate(seekDate);
    const utcMidnight = (year: number, month: number, day: number) => {
      const date = new Date(0);
      date.setUTCFullYear(year, month - 1, day);
      date.setUTCHours(0, 0, 0, 0);
      return date.getTime();
    };
    const hasCalendarFilters = [options.bymonth, options.bymonthday, options.bynmonthday, options.byweekno,
      options.byyearday, options.byeaster].some(value => Array.isArray(value) ? value.length > 0 : value != null);
    const weekdays = [...new Set<number>(Array.isArray(options.byweekday) ? options.byweekday : options.byweekday == null ? [] : [options.byweekday])];
    const dailyCountSafe = freq === Frequency.DAILY && !hasCalendarFilters;
    const weeklyCountSafe = freq === Frequency.WEEKLY && !hasCalendarFilters &&
      (options.bysetpos == null || (Array.isArray(options.bysetpos) && options.bysetpos.length === 0));
    if (freq === Frequency.DAILY && (!count || dailyCountSafe)) {
      const days = Math.floor((utcMidnight(target.year, target.month, target.day) - utcMidnight(counterDate.year, counterDate.month, counterDate.day)) / 86400000);
      const periods = Math.max(0, Math.floor(days / interval));
      const startWeekday = counterDate.getWeekday();
      counterDate.addDaily(periods * interval);
      if (count && dailyCountSafe) {
        const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
        const cycleLength = 7 / gcd(7, interval);
        const cycleMatches = Array.from({ length: cycleLength }, (_, index) =>
          weekdays.length === 0 || weekdays.includes((startWeekday + index * interval) % 7)).filter(Boolean).length;
        const fullCycles = Math.floor(periods / cycleLength), remainder = periods % cycleLength;
        let skippedMatches = fullCycles * cycleMatches;
        for (let index = 0; index < remainder; index++) {
          if (weekdays.length === 0 || weekdays.includes((startWeekday + index * interval) % 7)) skippedMatches++;
        }
        count = Math.max(0, count - skippedMatches);
      }
    } else if (freq === Frequency.WEEKLY && (!count || weeklyCountSafe)) {
      const weekStart = (value: DateTime) => {
        const back = ((value.getWeekday() - Number(options.wkst)) % 7 + 7) % 7;
        return utcMidnight(value.year, value.month, value.day - back);
      };
      const periodDays = interval * 7;
      const periods = Math.max(0, Math.floor((weekStart(target) - weekStart(counterDate)) / (periodDays * 86400000)));
      if (count && weeklyCountSafe) {
        const activeWeekdays = weekdays.length
          ? weekdays
          : [counterDate.getWeekday()];
        const firstPeriodBeforeStart = activeWeekdays.filter(day => {
          const firstWeekStart = weekStart(counterDate);
          const candidate = firstWeekStart + (((day - Number(options.wkst)) % 7 + 7) % 7) * 86400000;
          return candidate < utcMidnight(counterDate.year, counterDate.month, counterDate.day);
        }).length;
        const skippedOccurrences = periods > 0 ? periods * activeWeekdays.length - firstPeriodBeforeStart : 0;
        count = Math.max(0, count - skippedOccurrences);
      }
      if (periods > 0) {
        const sought = new Date(weekStart(counterDate) + periods * periodDays * 86400000);
        counterDate.year = sought.getUTCFullYear(); counterDate.month = sought.getUTCMonth() + 1; counterDate.day = sought.getUTCDate();
      }
    }
    if (count === 0) return result.getValue();
  }
  const ii = new Iterinfo(options);
  ii.rebuild(counterDate.year, counterDate.month);
  let timeset = makeTimeset(ii, counterDate, options);

  for (;;) {
    visitPeriod();
    const [dayset, start, end] = ii.getdayset(freq)(counterDate.year, counterDate.month, counterDate.day);
    const filtered = removeFilteredDays(dayset, start, end, ii, options);
    if (notEmpty(bysetpos)) {
      const poslist = buildPoslist(bysetpos, timeset, start, end, ii, dayset);
      for (const res of poslist) {
        if (until && res > until) return result.getValue();
        if (res >= dtstart && !accept(res)) return result.getValue();
      }
    } else {
      for (let j = start; j < end; j++) {
        const currentDay = dayset[j];
        if (!isPresent(currentDay)) continue;
        const date = fromOrdinal(ii.yearordinal + (currentDay as number));
        for (const time of timeset) {
          const res = combine(date, time);
          if (until && res > until) return result.getValue();
          if (res >= dtstart && !accept(res)) return result.getValue();
        }
      }
    }

    counterDate.add(options, filtered);
    if (counterDate.year > MAXYEAR) return result.getValue();
    if (!freqIsDailyOrGreater(freq)) {
      timeset = ii.gettimeset(freq)(counterDate.hour, counterDate.minute, counterDate.second, 0);
    }
    ii.rebuild(counterDate.year, counterDate.month);
  }

  function accept(res: Date): boolean {
    const accepted = result.accept(new DateWithZone(res, options.tzid).rezonedDate());
    if (!accepted) return false;
    if (count) {
      count--;
      if (!count) return false;
    }
    return true;
  }
}

function isFiltered(ii: InstanceType<typeof Iterinfo>, currentDay: number, options: ParsedOptions): boolean {
  const { bymonth, byweekno, byweekday, byeaster, bymonthday, bynmonthday, byyearday } = options;
  return ((notEmpty(bymonth) && !includes(bymonth, ii.mmask[currentDay])) ||
    (notEmpty(byweekno) && !ii.wnomask[currentDay]) ||
    (notEmpty(byweekday) && !includes(byweekday, ii.wdaymask[currentDay])) ||
    (notEmpty(ii.nwdaymask) && !ii.nwdaymask[currentDay]) ||
    (byeaster !== null && !includes(ii.eastermask as number[], currentDay)) ||
    ((notEmpty(bymonthday) || notEmpty(bynmonthday)) &&
      !includes(bymonthday, ii.mdaymask[currentDay]) && !includes(bynmonthday, ii.nmdaymask[currentDay])) ||
    (notEmpty(byyearday) &&
      ((currentDay < ii.yearlen && !includes(byyearday, currentDay + 1) && !includes(byyearday, -ii.yearlen + currentDay)) ||
        (currentDay >= ii.yearlen && !includes(byyearday, currentDay + 1 - ii.yearlen) && !includes(byyearday, -ii.nextyearlen + currentDay - ii.yearlen)))));
}

function removeFilteredDays(dayset: (number | null)[], start: number, end: number, ii: InstanceType<typeof Iterinfo>, options: ParsedOptions): boolean {
  let filtered = false;
  for (let dayCounter = start; dayCounter < end; dayCounter++) {
    const currentDay = dayset[dayCounter];
    filtered = isFiltered(ii, currentDay as number, options);
    if (filtered) dayset[currentDay as number] = null;
  }
  return filtered;
}

function makeTimeset(ii: InstanceType<typeof Iterinfo>, counterDate: InstanceType<typeof DateTime>, options: ParsedOptions): Time[] {
  const { freq, byhour, byminute, bysecond } = options;
  if (freqIsDailyOrGreater(freq)) return buildTimeset(options);
  if ((freq >= Frequency.HOURLY && notEmpty(byhour) && !includes(byhour, counterDate.hour)) ||
    (freq >= Frequency.MINUTELY && notEmpty(byminute) && !includes(byminute, counterDate.minute)) ||
    (freq >= Frequency.SECONDLY && notEmpty(bysecond) && !includes(bysecond, counterDate.second))) return [];
  return ii.gettimeset(freq)(counterDate.hour, counterDate.minute, counterDate.second, counterDate.millisecond);
}
