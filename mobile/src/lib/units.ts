/**
 * Unit conversion and display. Data is always kg and cm (on the device and on the wire);
 * conversion happens only at the edges, when showing a value or reading user input.
 */
import type { LengthUnit, WeightUnit } from '@/api/types';

export const KG_PER_LB = 0.45359237; // exact, by definition
export const CM_PER_IN = 2.54; // exact, by definition

/** Round half away from zero; the epsilon stops 1.005 → 1.00 from binary float error. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (
    (Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON * factor)) / factor
  );
}

export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const cmToIn = (cm: number): number => cm / CM_PER_IN;
export const inToCm = (inches: number): number => inches * CM_PER_IN;

/** Parse a number typed by the user: trims, accepts a decimal comma. Null if not a number. */
export function parseDecimal(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** A kg value in the user's unit, rounded for display (0.1). */
export function displayWeight(kg: number, unit: WeightUnit): number {
  return roundTo(unit === 'kg' ? kg : kgToLb(kg), 1);
}

/** User input in their unit → kg, at the server's precision (0.01 kg). */
export function weightToKg(value: number, unit: WeightUnit): number {
  return roundTo(unit === 'kg' ? value : lbToKg(value), 2);
}

function trimZero(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "72.5 kg", "160 lb". */
export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${trimZero(displayWeight(kg, unit))} ${unit}`;
}

export interface FeetInches {
  feet: number;
  inches: number;
}

/** Nearest whole inch, carried into feet (179.9 cm → 5′11″, never 5′12″). */
export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cmToIn(cm));
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export function feetInchesToCm({ feet, inches }: FeetInches): number {
  return roundTo(inToCm(feet * 12 + inches), 1);
}

/** "178 cm", "5′10″". */
export function formatHeight(cm: number, unit: LengthUnit): string {
  if (unit === 'cm') return `${Math.round(cm)} cm`;
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet}′${inches}″`;
}
