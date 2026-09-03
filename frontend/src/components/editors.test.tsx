import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffPanel, ValidationPanel } from "../App";
import { DynamicFieldEditor } from "./DynamicFieldEditor";
import { MessageEditor } from "./MessageEditor";
import { RawJsonEditor } from "./RawJsonEditor";
import { PersistentTextarea } from "./PersistentTextarea";

describe("dynamic editors", () => {
  it("edits nested fields without dropping siblings", () => {
    const change = vi.fn();
    render(
      <DynamicFieldEditor
        value={{ title: "old", metadata: { score: 1 } }}
        onChange={change}
      />,
    );
    fireEvent.change(screen.getByDisplayValue("old"), {
      target: { value: "new" },
    });
    expect(change).toHaveBeenCalledWith({
      title: "new",
      metadata: { score: 1 },
    });
  });

  it("uses resizable textareas for all string fields", () => {
    const { container } = render(
      <DynamicFieldEditor
        value={{ short: "one line", long: "line one\nline two" }}
        onChange={vi.fn()}
      />,
    );
    const textareas = Array.from(
      container.querySelectorAll<HTMLTextAreaElement>(".field-tile textarea"),
    );
    expect(textareas).toHaveLength(2);
    expect(textareas.every((textarea) => textarea.tagName === "TEXTAREA")).toBe(
      true,
    );
    expect(textareas[1]).toHaveAttribute("wrap", "soft");
  });

  it("renders root record fields as movable tiles", () => {
    const { container, unmount } = render(
      <DynamicFieldEditor
        value={{
          question: "Q",
          thinking: "T",
          answer: "A",
          messages: [{ role: "user", content: "M" }],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(
      container.querySelectorAll(".root-field-layout > .field-tile"),
    ).toHaveLength(5);
    expect(container.querySelector('[data-field-key="messages"]')).toHaveAttribute(
      "draggable",
      "true",
    );
    unmount();
  });

  it("persists tile locks and order", () => {
    window.localStorage.clear();
    const { container, unmount } = render(
      <DynamicFieldEditor value={{ question: "Q", answer: "A" }} onChange={vi.fn()} />,
    );
    fireEvent.dragStart(container.querySelector('[data-field-key="answer"]')!);
    fireEvent.drop(container.querySelector('[data-field-key="question"]')!, {
      dataTransfer: {},
    });
    fireEvent.click(
      container.querySelector('[aria-label="Lock question"]')!,
    );
    fireEvent.drop(
      container.querySelector('[data-field-key="answer"]')!,
      { dataTransfer: {} },
    );
    unmount();
    const restored = render(
      <DynamicFieldEditor value={{ question: "Q", answer: "A" }} onChange={vi.fn()} />,
    );
    expect(
      restored.container.querySelector('[aria-label="Unlock question"]'),
    ).toBeInTheDocument();
    expect(
      restored.container.querySelector(".field-tile")?.getAttribute("data-field-key"),
    ).toBe("answer");
    restored.unmount();
  });

  it("restores a manually resized textarea height", () => {
    window.localStorage.clear();
    const first = render(
      <PersistentTextarea
        storageKey="thinking"
        aria-label="Thinking"
        defaultValue="text"
      />,
    );
    const textarea = screen.getByLabelText("Thinking");
    Object.defineProperty(textarea, "offsetHeight", {
      configurable: true,
      value: 248,
    });
    fireEvent.pointerUp(textarea);
    first.unmount();
    render(
      <PersistentTextarea
        storageKey="thinking"
        aria-label="Thinking restored"
        defaultValue="text"
      />,
    );
    expect(screen.getByLabelText("Thinking restored")).toHaveStyle({
      height: "248px",
    });
    expect(screen.getByLabelText("Thinking restored")).toHaveAttribute(
      "wrap",
      "soft",
    );
  });

  it("preserves unknown message fields", () => {
    const change = vi.fn();
    render(
      <MessageEditor
        value={[
          { role: "assistant", content: "hello", metadata: { source: "x" } },
        ]}
        onChange={change}
      />,
    );
    fireEvent.change(screen.getByLabelText("Message 1 content"), {
      target: { value: "updated" },
    });
    expect(change).toHaveBeenCalledWith([
      { role: "assistant", content: "updated", metadata: { source: "x" } },
    ]);
  });

  it("rejects invalid raw JSON and applies an object", () => {
    const apply = vi.fn();
    render(<RawJsonEditor value={{ a: 1 }} onApply={apply} />);
    fireEvent.change(screen.getByLabelText("Raw JSON"), {
      target: { value: "[]" },
    });
    fireEvent.click(screen.getByText("Apply JSON"));
    expect(
      screen.getByText("Record must be a JSON object"),
    ).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Raw JSON"), {
      target: { value: '{"日本語":"今治"}' },
    });
    fireEvent.click(screen.getByText("Apply JSON"));
    expect(apply).toHaveBeenCalledWith({ 日本語: "今治" });
  });
});

describe("detail panels", () => {
  it("shows structural diff", () => {
    render(
      <DiffPanel
        items={[
          { type: "modified", path: "$.answer", before: "old", after: "new" },
        ]}
      />,
    );
    expect(screen.getByText("$.answer")).toBeInTheDocument();
    expect(screen.getByText(/"old"/)).toBeInTheDocument();
  });
  it("shows validation issues and empty success", () => {
    const { rerender } = render(
      <ValidationPanel
        issues={[
          {
            severity: "error",
            code: "REQUIRED_MISSING",
            path: "answer",
            message: "Required",
          },
        ]}
      />,
    );
    expect(screen.getByText("REQUIRED_MISSING")).toBeInTheDocument();
    rerender(<ValidationPanel issues={[]} />);
    expect(screen.getByText("Validation OK")).toBeInTheDocument();
  });
});
