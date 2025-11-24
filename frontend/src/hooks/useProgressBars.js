import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function buildInitialState(keys) {
  return keys.reduce((acc, key) => {
    acc[key] = { value: 0, label: "", active: false, status: "idle" };
    return acc;
  }, {});
}

const clampValue = (value, max = 100) => Math.max(0, Math.min(value, max));
const hasWindow = typeof window !== "undefined";
const scheduleInterval = (fn, ms) => (hasWindow ? window.setInterval(fn, ms) : null);
const clearScheduledInterval = (id) => {
  if (hasWindow && id) {
    window.clearInterval(id);
  }
};
const scheduleTimeout = (fn, ms) => (hasWindow ? window.setTimeout(fn, ms) : null);
const clearScheduledTimeout = (id) => {
  if (hasWindow && id) {
    window.clearTimeout(id);
  }
};

export function useProgressBars(keys = []) {
  const signature = useMemo(() => keys.join("|"), [keys]);
  const keySet = useMemo(() => new Set(keys), [signature]);
  const [progressState, setProgressState] = useState(() => buildInitialState(keys));
  const tickRefs = useRef({});
  const hideRefs = useRef({});

  useEffect(() => {
    setProgressState(buildInitialState(keys));
    return () => {
      Object.values(tickRefs.current).forEach((id) => clearScheduledInterval(id));
      Object.values(hideRefs.current).forEach((id) => clearScheduledTimeout(id));
    };
  }, [signature, keys]);

  const clearTimersForKey = useCallback((key) => {
    clearScheduledInterval(tickRefs.current[key]);
    clearScheduledTimeout(hideRefs.current[key]);
  }, []);

  const patchProgress = useCallback(
    (key, mapper) => {
      if (!keySet.has(key)) return;
      setProgressState((prev) => {
        const current = prev[key];
        if (typeof current === "undefined") return prev;
        const next = mapper(current);
        if (!next || next === current) return prev;
        return { ...prev, [key]: next };
      });
    },
    [keySet]
  );

  const startProgress = useCallback(
    (key, label = "", options = {}) => {
      const { autoTick = true, initialValue = 5 } = options || {};
      if (!keySet.has(key)) return;
      clearTimersForKey(key);
      const nextValue = clampValue(initialValue);
      patchProgress(key, (current) => ({
        value: nextValue,
        label: label || current.label || "",
        active: true,
        status: "running",
      }));
      if (!autoTick) {
        tickRefs.current[key] = null;
        return;
      }
      tickRefs.current[key] = scheduleInterval(() => {
        patchProgress(key, (current) => {
          if (!current.active || current.status !== "running") {
            return current;
          }
          const increment = (Math.random() * 6 + 2) * (hasWindow ? 1 : 0);
          const nextValue = clampValue(current.value + increment, 90);
          if (nextValue <= current.value + 0.01) {
            return current;
          }
          return { ...current, value: nextValue };
        });
      }, 600);
    },
    [clearTimersForKey, keySet, patchProgress]
  );

  const updateProgress = useCallback(
    (key, value, label) => {
      patchProgress(key, (current) => {
        const nextValue = typeof value === "number" ? clampValue(value, 100) : current.value;
        const nextLabel = label ?? current.label;
        if (nextValue === current.value && nextLabel === current.label && current.active) {
          return current;
        }
        return {
          ...current,
          value: nextValue,
          label: nextLabel,
          active: true,
        };
      });
    },
    [patchProgress]
  );

  const finishProgress = useCallback(
    (key, options = {}) => {
      if (!keySet.has(key)) return;
      const { label, error = false } = options;
      clearTimersForKey(key);
      patchProgress(key, (current) => ({
        ...current,
        value: 100,
        label: label || current.label,
        status: error ? "error" : "success",
        active: true,
      }));
      hideRefs.current[key] = scheduleTimeout(() => {
        patchProgress(key, () => ({ value: 0, label: "", active: false, status: "idle" }));
      }, error ? 1800 : 1200);
    },
    [clearTimersForKey, keySet, patchProgress]
  );

  return {
    progressState,
    startProgress,
    updateProgress,
    finishProgress,
  };
}
