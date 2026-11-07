import { create } from 'zustand';

import type { DraftItem, FoodDraft, LogSource, Meal, Per100g } from '@/api/types';

import { addLog } from './actions';
import { readEntry, type EntryForm, type EntryValues } from './entry';
import { formatAmount, unitOptions } from './rules';

// An AI draft on the review screen. Each row is an entry in grams, so it edits and recomputes
// exactly like any other log; nothing is logged until the user confirms.

const GRAMS = unitOptions([]);
const LOW_CONFIDENCE = 0.5;

/** A draft from typed text, handed to the review screen (a photo's is fetched by id). */
export const useTextDraft = create<{ draft: FoodDraft | null }>(() => ({ draft: null }));

export interface DraftRow {
  key: string;
  name: string;
  food_id: string | null;
  per_100g: Per100g;
  confidence: number;
  form: EntryForm;
}

function toRow(item: DraftItem, index: number): DraftRow {
  return {
    key: String(index),
    name: item.name,
    food_id: item.food_id,
    per_100g: item.per_100g,
    confidence: item.confidence,
    form: { quantity: formatAmount(item.grams), unit: 'g', macros: null, kcal: null },
  };
}

export function rowsFromDraft(draft: FoodDraft): DraftRow[] {
  return draft.items.map(toRow);
}

export function readRow(row: DraftRow): EntryValues {
  return readEntry(row.form, GRAMS, row.per_100g);
}

export function isUnsure(row: DraftRow): boolean {
  return row.confidence < LOW_CONFIDENCE;
}

export function draftKcal(rows: DraftRow[]): number {
  return Math.round(rows.reduce((total, row) => total + readRow(row).amounts.kcal, 0));
}

/** What stops the rows being logged, if anything. */
export function draftError(rows: DraftRow[]): string | null {
  for (const row of rows) {
    if (!row.name.trim()) return 'Every item needs a name';
    const { error } = readRow(row);
    if (error) return `${row.name}: ${error}`;
  }
  return null;
}

export interface DraftTarget {
  date: string;
  meal: Meal;
  source: LogSource;
  analysisId: string | null;
}

export async function confirmDraft(
  rows: DraftRow[],
  target: DraftTarget,
  now = Date.now(),
): Promise<void> {
  for (const [index, row] of rows.entries()) {
    const entry = readRow(row);
    await addLog(
      {
        log_date: target.date,
        meal: target.meal,
        food_id: row.food_id,
        name: row.name.trim(),
        brand: null,
        per_100g: row.per_100g,
        quantity: entry.quantity,
        unit: 'g',
        grams: entry.grams,
        macros: entry.macros,
        kcal: entry.kcal,
        source: target.source,
        photo_analysis_id: target.analysisId,
      },
      now + index,
    );
  }
}
