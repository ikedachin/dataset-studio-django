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

  it("splits root record fields into two columns", () => {
    const { container } = render(
      <DynamicFieldEditor
        value={{ question: "Q", answer: "A", metadata: { source: "x" } }}
        onChange={vi.fn()}
      />,
    );
    expect(
      container.querySelectorAll(".root-field-layout > .field-column"),
    ).toHaveLength(2);
    expect(container.querySelector(".field-column-primary")).toHaveTextContent(
      "question",
    );
    expect(
      container.querySelector(".field-column-secondary"),
    ).toHaveTextContent("metadata");
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
    expect(screen.getByText(/old/)).toBeInTheDocument();
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
