import React from "react";
import { canonicalKey } from "../utils/cells";
import { RobotSummaryCard } from "./RobotSummaryCard";

export function RobotSummaryList({ robotSummaries, robotLogs, robotColorMap, onSelectRobot }) {
  if (!robotSummaries || robotSummaries.length === 0) {
    return <div className="label">Run planning to view assignments.</div>;
  }

  return (
    <div className="robot-summary-list">
      {robotSummaries.map((robot) => {
        const robotKey = canonicalKey(robot.start) || JSON.stringify(robot.start);
        const log = robotLogs?.[robotKey];
        const robotColor = robot.color || robotColorMap?.[robotKey] || "#0b69ff";
        return (
          <RobotSummaryCard
            key={robot.id}
            robot={robot}
            robotColor={robotColor}
            log={log}
            onSelect={() => onSelectRobot(robotKey)}
          />
        );
      })}
    </div>
  );
}
