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

  const startProgress = useCallback(
    (key, label = "", options = {}) => {
      const { autoTick = true, initialValue = 5 } = options || {};
      if (!keys.includes(key)) return;
      clearScheduledInterval(tickRefs.current[key]);
      clearScheduledTimeout(hideRefs.current[key]);
      const nextValue = clampValue(initialValue);
      setProgressState((prev) => ({
        ...prev,
        [key]: {
          value: nextValue,
          label: label || prev[key]?.label || "",
          active: true,
          status: "running",
        },
      }));
      if (!autoTick) {
        tickRefs.current[key] = null;
        return;
      }
      tickRefs.current[key] = scheduleInterval(() => {
        setProgressState((prev) => {
          const current = prev[key];
          if (!current || !current.active || current.status !== "running") {
            return prev;
          }
          const increment = (Math.random() * 6 + 2) * (hasWindow ? 1 : 0);
          const nextValue = clampValue(current.value + increment, 90);
          if (nextValue <= current.value + 0.01) {
            return prev;
          }
          return {
            ...prev,
            [key]: { ...current, value: nextValue },
          };
        });
      }, 600);
    },
    [keys]
  );

  const updateProgress = useCallback((key, value, label) => {
    setProgressState((prev) => {
      const current = prev[key];
      if (!current) return prev;
      const nextValue = typeof value === "number" ? clampValue(value, 100) : current.value;
      return {
        ...prev,
        [key]: {
          ...current,
          value: nextValue,
          label: label ?? current.label,
          active: current.active || true,
        },
      };
    });
  }, []);

  const finishProgress = useCallback((key, options = {}) => {
    const { label, error = false } = options;
    clearScheduledInterval(tickRefs.current[key]);
    clearScheduledTimeout(hideRefs.current[key]);
    setProgressState((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return {
        ...prev,
        [key]: {
          ...current,
          value: 100,
          label: label || current.label,
          status: error ? "error" : "success",
          active: true,
        },
      };
    });
    hideRefs.current[key] = scheduleTimeout(() => {
      setProgressState((prev) => ({
        ...prev,
        [key]: { value: 0, label: "", active: false, status: "idle" },
      }));
    }, error ? 1800 : 1200);
  }, []);

  const resetProgress = useCallback((key) => {
    clearScheduledInterval(tickRefs.current[key]);
    clearScheduledTimeout(hideRefs.current[key]);
    setProgressState((prev) => ({
      ...prev,
      [key]: { value: 0, label: "", active: false, status: "idle" },
    }));
  }, []);

  const isRunning = useCallback((key) => progressState[key]?.status === "running", [progressState]);

  return {
    progressState,
    startProgress,
    updateProgress,
    finishProgress,
    resetProgress,
    isRunning,
  };
}
