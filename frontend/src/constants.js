export const BACKEND_URL = "http://localhost:5001/api";

export const MAX_ROBOTS = 5;
export const MAX_WIDTH = 200;
export const MAX_HEIGHT = 200;

export const ROBOT_COLORS = ["#0b69ff", "#ff5f55", "#2dbf88", "#e2a72e", "#7b5fff"];
export const COMPLETED_COLOR = "#25a86b";
export const FORKLIFT_COLOR = "#f5533e";
export const TASK_COLOR = "#ffcc00";
export const WALL_COLOR = "#24354e";
export const EMPTY_CELL_COLOR = "#f7fbff";
export const GRID_LINE_COLOR = "#e6f0fb";

export const CELL_SIZE = 24;

export const EXECUTION_DETAIL_INLINE_LIMIT = 3;
export const FORKLIFT_MIN_STEPS = 10;
export const FORKLIFT_MAX_STEPS = 35;

export const METRIC_PRIMARY_KEYS = [
  "total",
  "value",
  "score",
  "cost",
  "execution_time_s",
  "time_ms",
  "time",
  "duration",
  "avg",
  "average",
  "mean",
  "count",
];

export const DEFAULT_SPEED = 6;
export const MIN_SPEED = 1;
export const MAX_SPEED = 20;

export const DEFAULT_MAP_WIDTH = 30;
export const DEFAULT_MAP_HEIGHT = 20;

export const DEFAULT_WALL_RANGE = { min: 0.08, max: 0.18 };
export const DEFAULT_TASK_RANGE = { min: 9, max: 21 };
export const DEFAULT_MOVING_RANGE = { min: 1, max: 3 };
export const DEFAULT_ROBOT_RANGE = { min: 2, max: 4 };
