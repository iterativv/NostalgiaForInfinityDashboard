// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Session clock — terminal time base: UTC + local clock, weekday and forex
 * session indicators (Asia / London / New York) derived from UTC hours,
 * with each closed session's time-to-open counting down live. No backend
 * access required (public widget).
 */

import { useEffect, useState } from "react";
import { Tag } from "@carbon/react";
import { defineWidget } from "@nfi/widget-sdk";
import { EmptyConfigSchema } from "./shared/config";
import { Stat, WidgetFrame } from "@nfi/ui";

interface Session {
  readonly name: string;
  readonly short: string;
  /** [openHour, closeHour) in UTC. */
  readonly window: readonly [number, number];
}

const SESSIONS: ReadonlyArray<Session> = [
  { name: "Asia · Tokyo", short: "ASIA", window: [0, 8] },
  { name: "Europe · London", short: "LDN", window: [8, 16] },
  { name: "Americas · New York", short: "NYC", window: [13, 21] },
];

function sessionOpen(hour: number, window: readonly [number, number]): boolean {
  const [open, close] = window;
  if (open <= close) return hour >= open && hour < close;
  return hour >= open || hour < close;
}

/** Hours until the next session open (always > 0 for a closed session). */
const hoursToOpen = (
  hour: number,
  window: readonly [number, number],
): number => {
  const [open] = window;
  const diff = open - hour;
  return diff <= 0 ? diff + 24 : diff;
};

const fmtCountdown = (hours: number): string => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 60 ? `in ${h + 1}h` : `in ${h}h ${String(m).padStart(2, "0")}m`;
};

export function SessionClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const time = now.toISOString().slice(11, 19);
  const weekday = now.toLocaleDateString(undefined, { weekday: "short" });
  const localTime = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <WidgetFrame title="Session Clock">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
        <div className="nfi-stat-grid nfi-stat-grid--fill">
          <Stat
            label={`UTC · ${weekday}`}
            value={time}
            sub={now.toISOString().slice(0, 10)}
          />
          <Stat
            label="Local time"
            value={localTime}
            sub={Intl.DateTimeFormat().resolvedOptions().timeZone}
          />
        </div>
        <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
          {SESSIONS.map((session) => {
            const open = sessionOpen(utcHour, session.window);
            const countdown = fmtCountdown(
              hoursToOpen(utcHour, session.window),
            );
            return (
              <Tag
                key={session.short}
                type={open ? "green" : "gray"}
                size="sm"
                title={
                  open
                    ? `${session.name} — open`
                    : `${session.name} — opens ${countdown}`
                }
              >
                {session.short} {open ? "● open" : countdown}
              </Tag>
            );
          })}
        </div>
      </div>
    </WidgetFrame>
  );
}

export const SessionClockWidgetDef = defineWidget({
  type: "session-clock",
  title: "Session Clock",
  description:
    "UTC and local clock with Asia / London / New York session indicators.",
  configSchema: EmptyConfigSchema,
  defaultConfig: {},
  component: SessionClockWidget,
  capabilities: [],
  minWidth: 220,
  minHeight: 100,
});
