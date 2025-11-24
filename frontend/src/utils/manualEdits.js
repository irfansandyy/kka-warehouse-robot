export function createEmptyManualEdits() {
  return {
    robots: { add: [], remove: [] },
    tasks: { add: [], remove: [] },
    walls: { add: [], remove: [] },
    forklifts: { add: [], remove: [] },
  };
}
