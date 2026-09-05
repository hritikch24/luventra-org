import type { ColumnRole } from '@/app/worker/types';
import { normaliseHeader } from './seo-banks-data';

/**
 * Resolves a bank preset's header map into one role per column.
 *
 * A raw `headerMap` can name the same role twice — Chase checking has both
 * "Details" and "Type", and both derive to `type`. Roles are single-slot in
 * the convert request, so exactly one column may hold each. The rule is
 * last-claimant-wins, and losers fall back to `ignored`.
 *
 * Both the static layout table and the live workbench go through this, so the
 * "Pre-selected as" column on a bank page always matches the dropdown the user
 * actually sees. They diverged before this existed.
 */
export function resolvePresetRoles(
  headers: readonly string[],
  headerMap: Readonly<Record<string, ColumnRole>>,
): readonly (ColumnRole | undefined)[] {
  const wanted = headers.map((header) => headerMap[normaliseHeader(header)]);

  const winner = new Map<ColumnRole, number>();
  wanted.forEach((role, index) => {
    if (role === undefined || role === 'ignored') return;
    winner.set(role, index);
  });

  return wanted.map((role, index) => {
    if (role === undefined || role === 'ignored') return role;
    return winner.get(role) === index ? role : 'ignored';
  });
}
