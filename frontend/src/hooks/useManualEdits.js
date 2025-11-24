import { useCallback, useMemo, useState } from "react";

import { MAX_ROBOTS } from "../constants/config";
import { createEmptyManualEdits } from "../utils/manualEdits";
import { canonicalKey, cellKey, cellsEqual, parseCell, pathSignature } from "../utils/cells";
import { buildRandomForkliftPath } from "../utils/forklift";

function normalizeHoverCell({ grid, hoverCell, isEditMode }) {
  if (!isEditMode || !hoverCell || !Array.isArray(grid) || grid.length === 0) {
    return null;
  }
  const [row, col] = hoverCell;
  const withinRowBounds = row >= 0 && row < grid.length;
  const withinColBounds = col >= 0 && col < (Array.isArray(grid[row]) ? grid[row].length : 0);
  if (!withinRowBounds || !withinColBounds) {
    return null;
  }
  return [row, col];
}

export function useManualEdits({ grid, robots, tasks, moving, isEditMode }) {
  const [manualEdits, setManualEdits] = useState(() => createEmptyManualEdits());
  const [hoverCell, setHoverCell] = useState(null);

  const pendingRobotAdds = manualEdits.robots?.add || [];
  const pendingRobotRemovals = manualEdits.robots?.remove || [];
  const pendingTaskAdds = manualEdits.tasks?.add || [];
  const pendingTaskRemovals = manualEdits.tasks?.remove || [];
  const pendingWallAdds = manualEdits.walls?.add || [];
  const pendingWallRemovals = manualEdits.walls?.remove || [];
  const pendingForkliftAdds = manualEdits.forklifts?.add || [];
  const pendingForkliftRemovals = manualEdits.forklifts?.remove || [];

  const robotCellSet = useMemo(() => {
    const set = new Set();
    (robots || []).forEach((robot) => {
      const key = canonicalKey(robot);
      if (key) {
        set.add(key);
      }
    });
    return set;
  }, [robots]);

  const projectedRobotCount = useMemo(() => {
    let count = robotCellSet.size;
    pendingRobotAdds.forEach((cell) => {
      const key = canonicalKey(cell);
      if (key && !robotCellSet.has(key)) {
        count += 1;
      }
    });
    pendingRobotRemovals.forEach((cell) => {
      const key = canonicalKey(cell);
      if (key && robotCellSet.has(key)) {
        count -= 1;
      }
    });
    return count;
  }, [robotCellSet, pendingRobotAdds, pendingRobotRemovals]);

  const pendingAddSet = useMemo(() => {
    const set = new Set();
    pendingRobotAdds.forEach((cell) => {
      const key = canonicalKey(cell);
      if (key) set.add(key);
    });
    return set;
  }, [pendingRobotAdds]);

  const pendingRemoveSet = useMemo(() => {
    const set = new Set();
    pendingRobotRemovals.forEach((cell) => {
      const key = canonicalKey(cell);
      if (key) set.add(key);
    });
    return set;
  }, [pendingRobotRemovals]);

  const taskCellSet = useMemo(() => new Set((tasks || []).map((cell) => cellKey(cell))), [tasks]);
  const pendingTaskAddSet = useMemo(() => new Set((pendingTaskAdds || []).map((cell) => cellKey(cell))), [pendingTaskAdds]);
  const pendingTaskRemoveSet = useMemo(
    () => new Set((pendingTaskRemovals || []).map((cell) => cellKey(cell))),
    [pendingTaskRemovals]
  );
  const pendingWallAddSet = useMemo(() => new Set((pendingWallAdds || []).map((cell) => cellKey(cell))), [pendingWallAdds]);
  const pendingWallRemoveSet = useMemo(
    () => new Set((pendingWallRemovals || []).map((cell) => cellKey(cell))),
    [pendingWallRemovals]
  );
  const pendingForkliftAddKeys = useMemo(
    () =>
      new Set(
        (pendingForkliftAdds || [])
          .map((item) => pathSignature(item?.path || []))
          .filter((signature) => typeof signature === "string")
      ),
    [pendingForkliftAdds]
  );

  const pendingTotals = useMemo(
    () => ({
      robots: (pendingRobotAdds.length || 0) + (pendingRobotRemovals.length || 0),
      tasks: (pendingTaskAdds.length || 0) + (pendingTaskRemovals.length || 0),
      walls: (pendingWallAdds.length || 0) + (pendingWallRemovals.length || 0),
      forklifts: (pendingForkliftAdds.length || 0) + (pendingForkliftRemovals.length || 0),
    }),
    [
      pendingRobotAdds,
      pendingRobotRemovals,
      pendingTaskAdds,
      pendingTaskRemovals,
      pendingWallAdds,
      pendingWallRemovals,
      pendingForkliftAdds,
      pendingForkliftRemovals,
    ]
  );

  const hasPendingChanges = useMemo(() => {
    const categories = [
      pendingRobotAdds,
      pendingRobotRemovals,
      pendingTaskAdds,
      pendingTaskRemovals,
      pendingWallAdds,
      pendingWallRemovals,
      pendingForkliftAdds,
      pendingForkliftRemovals,
    ];
    return categories.some((list) => (list?.length || 0) > 0);
  }, [
    pendingRobotAdds,
    pendingRobotRemovals,
    pendingTaskAdds,
    pendingTaskRemovals,
    pendingWallAdds,
    pendingWallRemovals,
    pendingForkliftAdds,
    pendingForkliftRemovals,
  ]);

  const normalizedHoverCell = useMemo(
    () => normalizeHoverCell({ grid, hoverCell, isEditMode }),
    [grid, hoverCell, isEditMode]
  );

  const handleRobotShortcut = useCallback(() => {
    if (!normalizedHoverCell) return;
    const [row, col] = normalizedHoverCell;
    const key = canonicalKey(normalizedHoverCell);
    if (!key) return;

    if (pendingAddSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.robots || { add: [], remove: [] };
        const nextAdds = (bucket.add || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
        return { ...prev, robots: { add: nextAdds, remove: bucket.remove || [] } };
      });
      return;
    }

    if (pendingRemoveSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.robots || { add: [], remove: [] };
        const nextRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
        return { ...prev, robots: { add: bucket.add || [], remove: nextRemoves } };
      });
      return;
    }

    if (robotCellSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.robots || { add: [], remove: [] };
        const nextRemoves = [...(bucket.remove || [])];
        if (nextRemoves.some((cell) => cellsEqual(cell, normalizedHoverCell))) {
          return prev;
        }
        nextRemoves.push([row, col]);
        return { ...prev, robots: { add: bucket.add || [], remove: nextRemoves } };
      });
      return;
    }

    if (projectedRobotCount >= MAX_ROBOTS) {
      alert(`Maximum ${MAX_ROBOTS} robots allowed`);
      return;
    }

    setManualEdits((prev) => {
      const bucket = prev.robots || { add: [], remove: [] };
      const existingAdds = bucket.add || [];
      if (existingAdds.some((cell) => cellsEqual(cell, normalizedHoverCell))) {
        return prev;
      }
      const cleansedRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
      return {
        ...prev,
        robots: {
          add: [...existingAdds, [row, col]],
          remove: cleansedRemoves,
        },
      };
    });
  }, [normalizedHoverCell, pendingAddSet, pendingRemoveSet, robotCellSet, projectedRobotCount]);

  const handleTaskShortcut = useCallback(() => {
    if (!normalizedHoverCell) return;
    const [row, col] = normalizedHoverCell;
    const key = cellKey(normalizedHoverCell);

    if (pendingTaskAddSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.tasks || { add: [], remove: [] };
        const nextAdds = (bucket.add || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
        return { ...prev, tasks: { add: nextAdds, remove: bucket.remove || [] } };
      });
      return;
    }

    if (pendingTaskRemoveSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.tasks || { add: [], remove: [] };
        const nextRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
        return { ...prev, tasks: { add: bucket.add || [], remove: nextRemoves } };
      });
      return;
    }

    if (taskCellSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.tasks || { add: [], remove: [] };
        if ((bucket.remove || []).some((cell) => cellsEqual(cell, normalizedHoverCell))) {
          return prev;
        }
        return {
          ...prev,
          tasks: {
            add: bucket.add || [],
            remove: [...(bucket.remove || []), [row, col]],
          },
        };
      });
      return;
    }

    if (grid[row][col] === 1) {
      alert("Cannot place a task on a wall cell.");
      return;
    }

    setManualEdits((prev) => {
      const bucket = prev.tasks || { add: [], remove: [] };
      if ((bucket.add || []).some((cell) => cellsEqual(cell, normalizedHoverCell))) {
        return prev;
      }
      const cleansedRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
      return {
        ...prev,
        tasks: {
          add: [...(bucket.add || []), [row, col]],
          remove: cleansedRemoves,
        },
      };
    });
  }, [grid, normalizedHoverCell, pendingTaskAddSet, pendingTaskRemoveSet, taskCellSet]);

  const handleWallShortcut = useCallback(() => {
    if (!normalizedHoverCell) return;
    const [row, col] = normalizedHoverCell;
    const key = cellKey(normalizedHoverCell);

    if (pendingWallAddSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.walls || { add: [], remove: [] };
        const nextAdds = (bucket.add || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
        return { ...prev, walls: { add: nextAdds, remove: bucket.remove || [] } };
      });
      return;
    }

    if (pendingWallRemoveSet.has(key)) {
      setManualEdits((prev) => {
        const bucket = prev.walls || { add: [], remove: [] };
        const nextRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
        return { ...prev, walls: { add: bucket.add || [], remove: nextRemoves } };
      });
      return;
    }

    if (grid[row][col] === 1) {
      setManualEdits((prev) => {
        const bucket = prev.walls || { add: [], remove: [] };
        if ((bucket.remove || []).some((cell) => cellsEqual(cell, normalizedHoverCell))) {
          return prev;
        }
        return {
          ...prev,
          walls: {
            add: bucket.add || [],
            remove: [...(bucket.remove || []), [row, col]],
          },
        };
      });
      return;
    }

    setManualEdits((prev) => {
      const bucket = prev.walls || { add: [], remove: [] };
      if ((bucket.add || []).some((cell) => cellsEqual(cell, normalizedHoverCell))) {
        return prev;
      }
      const cleansedRemoves = (bucket.remove || []).filter((cell) => !cellsEqual(cell, normalizedHoverCell));
      return {
        ...prev,
        walls: {
          add: [...(bucket.add || []), [row, col]],
          remove: cleansedRemoves,
        },
      };
    });
  }, [grid, normalizedHoverCell, pendingWallAddSet, pendingWallRemoveSet]);

  const handleForkliftShortcut = useCallback(() => {
    if (!normalizedHoverCell) return;
    const [row, col] = normalizedHoverCell;

    const existingIdx = (moving || []).findIndex((ob) => {
      if (!ob?.path || ob.path.length === 0) return false;
      const firstCell = parseCell(ob.path[0]);
      return firstCell ? cellsEqual(firstCell, normalizedHoverCell) : false;
    });

    if (existingIdx !== -1) {
      setManualEdits((prev) => {
        const bucket = prev.forklifts || { add: [], remove: [] };
        const removalSet = new Set(bucket.remove || []);
        const nextRemoves = removalSet.has(existingIdx)
          ? (bucket.remove || []).filter((idx) => idx !== existingIdx)
          : [...(bucket.remove || []), existingIdx];
        return {
          ...prev,
          forklifts: {
            add: bucket.add || [],
            remove: nextRemoves,
          },
        };
      });
      return;
    }

    if (grid[row][col] === 1) {
      alert("Cannot place a forklift path on a wall cell.");
      return;
    }

    const randomPath = buildRandomForkliftPath(grid, [row, col]);
    if (!randomPath || randomPath.length < 2) {
      alert("Could not build a random forklift path at that cell.");
      return;
    }

    const signature = pathSignature(randomPath);
    if (pendingForkliftAddKeys.has(signature)) {
      setManualEdits((prev) => {
        const bucket = prev.forklifts || { add: [], remove: [] };
        const nextAdds = (bucket.add || []).filter((item) => pathSignature(item?.path || []) !== signature);
        return {
          ...prev,
          forklifts: {
            add: nextAdds,
            remove: bucket.remove || [],
          },
        };
      });
      return;
    }

    setManualEdits((prev) => {
      const bucket = prev.forklifts || { add: [], remove: [] };
      return {
        ...prev,
        forklifts: {
          add: [...(bucket.add || []), { path: randomPath, loop: false }],
          remove: bucket.remove || [],
        },
      };
    });
  }, [grid, moving, normalizedHoverCell, pendingForkliftAddKeys]);

  const resetManualEdits = useCallback(() => {
    setManualEdits(createEmptyManualEdits());
  }, []);

  return {
    manualEdits,
    hoverCell,
    setHoverCell,
    hasPendingChanges,
    pendingTotals,
    pendingRobotAdds,
    pendingRobotRemovals,
    pendingTaskAdds,
    pendingTaskRemovals,
    pendingWallAdds,
    pendingWallRemovals,
    pendingForkliftAdds,
    pendingForkliftRemovals,
    handleRobotShortcut,
    handleTaskShortcut,
    handleWallShortcut,
    handleForkliftShortcut,
    resetManualEdits,
  };
}
