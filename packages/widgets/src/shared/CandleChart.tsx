// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * CandleChart — OHLCV candlesticks rendered with TradingView's
 * `lightweight-charts` (canvas, crosshair, pan/zoom included).
 *
 * Price overlays (SMA/EMA/Bollinger/VWAP) are `LineSeries` on the main
 * chart, volume is an overlaid `HistogramSeries`, and the oscillator
 * subplot (RSI/MACD) is a second chart with its time scale synced to the
 * main one. Indicator *values* come from the caller — this component only
 * renders series data.
 *
 * Terminal behaviors: the chart fills all vertical space the host gives it
 * (`autoSize` on both panes; the subplot takes a fixed share), the zoom/
 * pan range survives data updates, and the crosshair drives an OHLCV+
 * indicators legend showing the hovered bar (falling back to the last bar).
 */

import { useEffect, useMemo, useRef, useState } from "react"
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts"
import type { Candle } from "@nfi/api-contract"

export interface TvOverlayLine {
  readonly name: string
  readonly color: string
  readonly data: LineData[]
  readonly lineWidth?: number
  readonly dashed?: boolean
}

export interface TvSubplot {
  /** Lines drawn in the subplot pane (e.g. RSI, or MACD + signal). */
  readonly lines: TvOverlayLine[]
  /** Optional histogram (e.g. MACD hist, colored by sign by the caller). */
  readonly histogram?: HistogramData[]
  /** Dashed reference levels via price lines (e.g. RSI 70/50/30). */
  readonly levels?: ReadonlyArray<{ price: number; title?: string }>
}

const UP = "#26a69a"
const DOWN = "#ef5350"

const toSec = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp

/**
 * Sanitize a time series for lightweight-charts: it asserts strictly
 * ascending UNIQUE times, but freqtrade candle windows can occasionally
 * contain duplicated or sub-second-apart timestamps (re-analysis rolls,
 * partial-candle updates) — one duplicate crashes the whole widget.
 * Keep the LAST point per timestamp (newest data wins) and sort ascending.
 */
export function orderedByTime<T extends { time: unknown }>(
  points: ReadonlyArray<T>,
): T[] {
  const byTime = new Map<number, T>()
  for (const point of points) byTime.set(Number(point.time), point)
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, point]) => point)
}

interface LegendBar {
  readonly time: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume?: number
  readonly prevClose?: number
}

interface LegendOverlay {
  readonly name: string
  readonly color: string
  readonly value: number
}

const fmtVolumeLegend = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return "—"
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(0)
}

export function CandleChart({
  candles,
  overlays,
  showVolume,
  subplot,
}: {
  candles: ReadonlyArray<Candle>
  overlays: ReadonlyArray<TvOverlayLine>
  showVolume: boolean
  subplot: TvSubplot | null
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const priceRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const rangeRef = useRef<{ from: number; to: number } | null>(null)
  const [legend, setLegend] = useState<LegendBar | null>(null)
  const [legendOverlays, setLegendOverlays] = useState<readonly LegendOverlay[]>([])
  // Measured host height (8px steps to avoid chart churn on sub-pixel drag).
  // Charts need explicit pixel pane heights: created against a zero-height
  // flex container they keep a blank default-sized bitmap.
  const [boxHeight, setBoxHeight] = useState(340)

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const h = Math.floor((entries[0]?.contentRect.height ?? 0) / 8) * 8
      if (h > 0) setBoxHeight(h)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const subHeight = subplot ? Math.max(76, Math.round(boxHeight * 0.26)) : 0
  const priceHeight = Math.max(160, boxHeight - subHeight)

  const precision = useMemo(() => {
    const last = candles[candles.length - 1]?.close ?? 0
    if (!Number.isFinite(last) || last <= 0) return 4
    if (last >= 100) return 2
    if (last >= 1) return 4
    return 6
  }, [candles])

  const candleData = useMemo<CandlestickData[]>(
    () =>
      orderedByTime(
        candles.map((c) => ({
          time: toSec(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      ),
    [candles],
  )

  const volumeData = useMemo<HistogramData[]>(
    () =>
      orderedByTime(
        candles.map((c) => ({
          time: toSec(c.time),
          value: c.volume,
          color: c.close >= c.open ? "rgba(38, 166, 154, 0.4)" : "rgba(239, 83, 80, 0.4)",
        })),
      ),
    [candles],
  )

  const volumeByTime = useMemo(
    () => new Map(volumeData.map((d) => [d.time as number, d.value])),
    [volumeData],
  )

  /** time -> previous bar's close, for the legend's Δ vs prev close. */
  const prevCloseByTime = useMemo(() => {
    const map = new Map<number, number>()
    for (let i = 1; i < candleData.length; i++) {
      map.set(candleData[i]!.time as number, candleData[i - 1]!.close)
    }
    return map
  }, [candleData])

  useEffect(() => {
    const priceEl = priceRef.current
    if (!priceEl || candleData.length === 0) return

    const baseOptions = {
      layout: {
        // No "TradingView" attribution logo in the chart corner. (This is a
        // LAYOUT option in lightweight-charts v5 — top-level is ignored.)
        attributionLogo: false,
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a8a8a8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.06)" },
        horzLines: { color: "rgba(255, 255, 255, 0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(244, 244, 244, 0.4)", labelBackgroundColor: "#525252" },
        horzLine: { color: "rgba(244, 244, 244, 0.4)", labelBackgroundColor: "#525252" },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    } as const

    const chart: IChartApi = createChart(priceEl, {
      ...baseOptions,
      width: priceEl.clientWidth || 600,
      height: priceHeight,
      autoSize: true,
    })
    const candleSeries: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    })
    candleSeries.setData(candleData)

    const volumeSeries: ISeriesApi<"Histogram"> | null = showVolume
      ? chart.addSeries(HistogramSeries, {
          priceScaleId: "",
          priceFormat: { type: "volume" },
        })
      : null
    if (volumeSeries) {
      chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      volumeSeries.setData(volumeData)
    }

    // Overlay lines, remembered by series for the crosshair legend.
    const overlayNames = new Map<ISeriesApi<"Line">, { name: string; color: string }>()
    for (const overlay of overlays) {
      if (overlay.data.length === 0) continue
      const line = chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: (overlay.lineWidth ?? 1) as 1 | 2 | 3 | 4,
        lineStyle: overlay.dashed ? LineStyle.Dashed : LineStyle.Solid,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      line.setData(orderedByTime(overlay.data))
      overlayNames.set(line, { name: overlay.name, color: overlay.color })
    }

    let subChart: IChartApi | null = null
    const subEl = subRef.current
    if (subplot && subEl) {
      subChart = createChart(subEl, {
        ...baseOptions,
        width: subEl.clientWidth || 600,
        height: subHeight,
        autoSize: true,
      })
      for (const lineDef of subplot.lines) {
        if (lineDef.data.length === 0) continue
        const line = subChart.addSeries(LineSeries, {
          color: lineDef.color,
          lineWidth: (lineDef.lineWidth ?? 1) as 1 | 2 | 3 | 4,
          lineStyle: lineDef.dashed ? LineStyle.Dashed : LineStyle.Solid,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        })
        line.setData(orderedByTime(lineDef.data))
      }
      if (subplot.histogram && subplot.histogram.length > 0) {
        const hist = subChart.addSeries(HistogramSeries, { priceScaleId: "" })
        subChart.priceScale("").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } })
        hist.setData(orderedByTime(subplot.histogram))
      }
      // Reference levels (RSI 70/50/30…) via price lines on a hidden
      // anchor series, so they never shift the subplot's own scale.
      if (subplot.levels && subplot.levels.length > 0) {
        const anchor = subChart.addSeries(LineSeries, {
          color: "transparent",
          lineWidth: 1,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          visible: false,
        })
        for (const level of subplot.levels) {
          anchor.createPriceLine({
            price: level.price,
            color: "rgba(255, 255, 255, 0.25)",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: level.title ?? String(level.price),
          })
        }
      }
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) {
          rangeRef.current = range
          subChart?.timeScale().setVisibleLogicalRange(range)
        }
      })
    } else {
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) rangeRef.current = range
      })
    }

    // Preserve the user's zoom/pan across data polls and toggles.
    if (rangeRef.current) {
      chart.timeScale().setVisibleLogicalRange(rangeRef.current)
      subChart?.timeScale().setVisibleLogicalRange(rangeRef.current)
    } else {
      chart.timeScale().fitContent()
      subChart?.timeScale().fitContent()
      // Hide the oversized fit-content range on first paint for small sets.
      if (candleData.length < 60) {
        const to = candleData.length + 4
        const from = Math.max(0, to - 60)
        chart.timeScale().setVisibleLogicalRange({ from, to })
        subChart?.timeScale().setVisibleLogicalRange({ from, to })
      }
    }

    const onCrosshair = (param: {
      time?: unknown
      seriesData?: Map<unknown, unknown>
    }) => {
      const raw = param.seriesData?.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined
      if (raw && typeof param.time === "number") {
        setLegend({
          time: param.time * 1000,
          open: raw.open,
          high: raw.high,
          low: raw.low,
          close: raw.close,
          volume: volumeByTime.get(param.time),
          prevClose: prevCloseByTime.get(param.time),
        })
        const atCursor: LegendOverlay[] = []
        for (const [series, meta] of overlayNames) {
          const point = param.seriesData?.get(series) as { value: number } | undefined
          if (point && Number.isFinite(point.value)) {
            atCursor.push({ name: meta.name, color: meta.color, value: point.value })
          }
        }
        setLegendOverlays(atCursor)
      } else {
        setLegend(null)
        setLegendOverlays([])
      }
    }
    chart.subscribeCrosshairMove(onCrosshair as Parameters<typeof chart.subscribeCrosshairMove>[0])

    return () => {
      chart.remove()
      subChart?.remove()
    }
  }, [candleData, volumeData, volumeByTime, overlays, showVolume, subplot, precision, prevCloseByTime, priceHeight, subHeight])

  // Legend fallback: the last sanitized bar (sorted, deduped — so it is
  // genuinely the newest), with its volume and previous close.
  const lastPoint = candleData[candleData.length - 1]
  const prevPoint = candleData[candleData.length - 2]
  const bar: LegendBar | null = legend
    ? legend
    : lastPoint
      ? {
          time: (lastPoint.time as number) * 1000,
          open: lastPoint.open,
          high: lastPoint.high,
          low: lastPoint.low,
          close: lastPoint.close,
          volume: volumeByTime.get(lastPoint.time as number),
          prevClose: prevPoint?.close,
        }
      : null
  const barChange =
    bar && bar.prevClose !== undefined && bar.prevClose !== 0
      ? ((bar.close - bar.prevClose) / Math.abs(bar.prevClose)) * 100
      : null

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 240,
      }}
    >
      <div className="nfi-mono nfi-candle-legend" aria-live="polite">
        {bar ? (
          <>
            <span style={{ color: bar.close >= bar.open ? UP : DOWN, fontWeight: 600 }}>
              {bar.close.toFixed(precision)}
              {barChange !== null ? (
                <span style={{ marginLeft: "0.375rem" }}>
                  ({barChange >= 0 ? "+" : ""}
                  {barChange.toFixed(2)}%)
                </span>
              ) : null}
            </span>
            <span style={{ opacity: 0.7 }}>
              O {bar.open.toFixed(precision)} H {bar.high.toFixed(precision)} L{" "}
              {bar.low.toFixed(precision)} C {bar.close.toFixed(precision)}
            </span>
            {bar.volume !== undefined ? (
              <span style={{ opacity: 0.55 }}>V {fmtVolumeLegend(bar.volume)}</span>
            ) : null}
            {legendOverlays.map((o) => (
              <span key={o.name} style={{ color: o.color }}>
                {o.name} {o.value.toFixed(precision)}
              </span>
            ))}
            <span style={{ opacity: 0.55 }}>
              {Number.isNaN(new Date(bar.time).getTime())
                ? ""
                : new Date(bar.time).toISOString().slice(0, 16).replace("T", " ")}
            </span>
          </>
        ) : null}
        {legend === null
          ? overlays
              .filter((o) => !legendOverlays.some((l) => l.name === o.name))
              .map((o) => (
                <span key={o.name} style={{ color: o.color, opacity: 0.8 }}>
                  {o.name}
                </span>
              ))
          : null}
      </div>
      {/* Pane container ONLY: the ResizeObserver measures this box, and the
          panes below are sized from that measurement — content height always
          equals measured height, so the loop converges instead of growing.
          Never put extra siblings (legend, toolbars) inside it. */}
      <div
        ref={hostRef}
        style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <div ref={priceRef} style={{ width: "100%", flex: "0 0 auto", height: priceHeight }} />
        {subplot ? (
          <div ref={subRef} style={{ width: "100%", flex: "0 0 auto", height: subHeight }} />
        ) : null}
      </div>
    </div>
  )
}
