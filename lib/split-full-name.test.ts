import { describe, it, expect } from "vitest";
import { splitFullName } from "./split-full-name";

describe("splitFullName", () => {
  it("splits a normal two-word name", () => {
    expect(splitFullName("John Smith")).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("keeps everything after the first word as the last name for a multi-word name", () => {
    expect(splitFullName("Mary Jane Watson")).toEqual({ firstName: "Mary", lastName: "Jane Watson" });
  });

  it("handles a single-word name without losing it -- the edge case a naive split could drop", () => {
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });

  it("trims surrounding whitespace and collapses internal double spaces", () => {
    expect(splitFullName("  John   Smith  ")).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("handles an empty string without throwing", () => {
    expect(splitFullName("")).toEqual({ firstName: "", lastName: "" });
  });
});
