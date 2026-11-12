/** A closed poll has a winner only when exactly one option has a positive lead. */
export function pollResult(options: readonly { id: string }[], counts: ReadonlyMap<string, number>) {
  const topCount = Math.max(0, ...options.map(option => counts.get(option.id) ?? 0));
  const leaders = topCount > 0 ? options.filter(option => counts.get(option.id) === topCount).map(option => option.id) : [];
  return { winnerId: leaders.length === 1 ? leaders[0] : null, tiedIds: leaders.length > 1 ? leaders : [], hasVotes: topCount > 0 };
}
