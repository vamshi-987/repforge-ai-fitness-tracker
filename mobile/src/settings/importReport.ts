import type { ImportReport } from '@/api/types';

/** One plain sentence or two on how an import went. */
export function describeImport(report: ImportReport): string {
  const parts = [`${report.imported} ${report.imported === 1 ? 'workout' : 'workouts'} imported.`];
  if (report.duplicates > 0) parts.push(`${report.duplicates} already here.`);
  if (report.invalid.length > 0) parts.push(`${report.invalid.length} couldn’t be read.`);
  if (report.unknown_exercises.length > 0) {
    const names = report.unknown_exercises.slice(0, 3).join(', ');
    parts.push(`Skipped workouts with exercises we don’t know: ${names}.`);
  }
  return parts.join(' ');
}
