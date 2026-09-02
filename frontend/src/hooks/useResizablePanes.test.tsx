import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useResizablePanes } from "./useResizablePanes";

describe("useResizablePanes", () => {
  beforeEach(() => window.localStorage.clear());

  it("adjusts both pane widths and restores them from storage", () => {
    const first = renderHook(() => useResizablePanes());
    expect(first.result.current.widths).toEqual({ left: 240, right: 300 });
    act(() => {
      first.result.current.nudge("left", 40);
      first.result.current.nudge("right", -60);
    });
    expect(first.result.current.widths).toEqual({ left: 280, right: 360 });
    first.unmount();
    const restored = renderHook(() => useResizablePanes());
    expect(restored.result.current.widths).toEqual({ left: 280, right: 360 });
  });
});
