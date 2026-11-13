import { describe, expect, it } from "vitest";
import { areaChart, series, smoothPath, sparkline, SPARK_SERIES } from "./site-charts";

describe("website preview charts", () => {
  it("series() is deterministic and follows the formula", () => {
    const a = series(14, 3, 20, 7, 10);
    expect(a).toEqual(series(14, 3, 20, 7, 10));
    expect(a).toHaveLength(14);
    // i = 0: s = (3·9301 + 49297) mod 233280 = 77200, r = 77200/233280
    const r0 = 77200 / 233280;
    expect(a[0]).toBeCloseTo(20 + Math.sin(3) * 3.5 + (r0 - 0.5) * 7, 10);
  });

  it("smooth paths use mid-x control points", () => {
    expect(smoothPath([{ x: 0, y: 10 }, { x: 10, y: 0 }])).toBe("M0 10 C5 10 5 0 10 0");
  });

  it("sparklines stay inside their 200×30 box", () => {
    for (const s of SPARK_SERIES) {
      const { line, area } = sparkline(series(...s));
      const nums = line.replace(/[MC]/g, " ").trim().split(/\s+/).map(Number);
      const ys = nums.filter((_, i) => i % 2 === 1);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(4 - 1e-9);
      expect(Math.max(...ys)).toBeLessThanOrEqual(28 + 1e-9);
      expect(area.endsWith("Z")).toBe(true);
    }
  });

  it("area chart: grid lines, both series and the marker at point 22", () => {
    const c = areaChart();
    expect(c.grid).toEqual([12, 53.5, 95, 136.5, 178]);
    expect(c.marker.x).toBeCloseTo((22 * 600) / 29, 10);
    expect(c.marker.y).toBeGreaterThan(12);
    expect(c.marker.y).toBeLessThan(178);
    expect(c.a.line.startsWith("M0 ")).toBe(true);
  });
});
