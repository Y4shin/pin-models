import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createStlZip } from "./export";

describe("ZIP export", () => {
  it("packages every STL file with its filename", async () => {
    const files = [
      {
        filename: "watermelon-red.stl",
        data: new Uint8Array([1, 2, 3]).buffer,
      },
      {
        filename: "watermelon-black.stl",
        data: new Uint8Array([4, 5, 6, 7]).buffer,
      },
    ];

    const blob = await createStlZip(files);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();

    expect(names).toEqual(["watermelon-black.stl", "watermelon-red.stl"]);
    expect(
      new Uint8Array(await zip.files["watermelon-black.stl"].async("arraybuffer")),
    ).toEqual(new Uint8Array([4, 5, 6, 7]));
  });
});
