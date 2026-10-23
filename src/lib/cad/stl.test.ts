import { describe, expect, it } from "vitest";
import {
  combineBinaryStl,
  groupPartsByColor,
  slugify,
  stlFilenames,
} from "./stl";

function binaryStl(triangleCount: number): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangleCount, true);
  return buffer;
}

describe("generic color grouping and STL filenames", () => {
  it("groups any number of parts by color", () => {
    const groups = groupPartsByColor([
      { id: "a", color: "red" },
      { id: "b", color: "black" },
      { id: "c", color: "black" },
      { id: "d", color: "white" },
      { id: "e", color: "green" },
      { id: "f", color: "black" },
    ]);

    expect(groups.map((group) => [group.color, group.parts.length])).toEqual([
      ["red", 1],
      ["black", 3],
      ["white", 1],
      ["green", 1],
    ]);
  });

  it("creates stable, collision-free filenames for arbitrary colors", () => {
    expect(stlFilenames("Watermelon", ["red", "green", "white", "black"])).toEqual([
      "watermelon-red.stl",
      "watermelon-green.stl",
      "watermelon-white.stl",
      "watermelon-black.stl",
    ]);

    expect(stlFilenames("My Model!", ["Dark Red", "dark-red", "#ff0000"])).toEqual([
      "my-model-dark-red.stl",
      "my-model-dark-red-2.stl",
      "my-model-ff0000.stl",
    ]);
  });

  it("slugifies unusual names to a safe fallback", () => {
    expect(slugify("!!!")).toBe("part");
    expect(slugify("Red / Green")).toBe("red-green");
  });

  it("combines binary STLs without changing triangle data", () => {
    const single = binaryStl(2);
    const double = binaryStl(3);
    const combined = combineBinaryStl([single, double]);

    expect(new DataView(combined).getUint32(80, true)).toBe(5);
    expect(combined.byteLength).toBe(84 + 5 * 50);
  });

  it("rejects malformed STL data", () => {
    expect(() => combineBinaryStl([new ArrayBuffer(10)])).toThrow(/too short/);

    const invalidLength = new ArrayBuffer(84 + 20);
    new DataView(invalidLength).setUint32(80, 1, true);
    expect(() => combineBinaryStl([invalidLength])).toThrow(/unexpected file length/);
  });
});
