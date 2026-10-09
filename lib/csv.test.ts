import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("neutralises formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1 615 555 0100")).toBe("'+1 615 555 0100");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2+3")).toBe("'-2+3");
  });
  it("leaves plain numbers and text alone", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell("Maria")).toBe("Maria");
    expect(csvCell(null)).toBe("");
  });
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(csvCell("a\r\nb")).toBe("\"a\r\nb\"");
  });
});

describe("toCsv", () => {
  it("writes a header row even with no data when headers are given", () => {
    expect(toCsv([], ["id", "name"])).toBe("id,name");
  });
  it("returns an empty string with no rows and no headers", () => {
    expect(toCsv([])).toBe("");
  });
  it("writes rows", () => {
    expect(toCsv([{ id: 1, name: "A" }, { id: 2, name: "=B" }])).toBe("id,name\r\n1,A\r\n2,'=B");
  });
});
