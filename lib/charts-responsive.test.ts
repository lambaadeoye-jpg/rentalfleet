import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColumnChart, PercentLine, BarList } from "../app/staff/charts";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const weeks = ["2026-09-07", "2026-09-14", "2026-09-21"];

describe("charts stay readable on a phone", () => {
  it("column chart draws a wide and a compact version and one data table", () => {
    const h = html(createElement(ColumnChart, { labels: weeks, series: [{ name: "Rent", color: "#2a78d6", values: [100, 200, 300] }], money: true, emptyText: "none", tableTitle: "Rent" }));
    expect(h).toContain('class="viz-wide"');
    expect(h).toContain('class="viz-narrow"');
    expect(h).toContain('viewBox="0 0 640 240"');
    expect(h).toContain('viewBox="0 0 360 230"');
    expect(h.match(/<table/g)?.length).toBe(1);
  });
  it("percent line does the same", () => {
    const h = html(createElement(PercentLine, { labels: weeks, values: [40, 50, 60], color: "#2a78d6", emptyText: "none", tableTitle: "Utilization" }));
    expect(h).toContain("viz-wide");
    expect(h).toContain("viz-narrow");
    expect(h).toContain('aria-label="Utilization"');
  });
  it("empty data shows the message, not two empty frames", () => {
    const h = html(createElement(ColumnChart, { labels: [], series: [], emptyText: "No data yet.", tableTitle: "x" }));
    expect(h).toContain("No data yet.");
    expect(h).not.toContain("<svg");
    expect(html(createElement(BarList, { items: [], emptyText: "Nothing." }))).toContain("Nothing.");
  });
});
