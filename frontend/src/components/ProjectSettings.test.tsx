import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSettings } from "./ProjectSettings";

const project = {
  id: 1,
  name: "Example",
  sourceType: "local" as const,
  inferredSchema: {},
  syncRules: [],
  identifierFields: ["id"],
  validationSettings: {},
};

describe("ProjectSettings sync rule help", () => {
  it("is closed initially and provides source and template examples", () => {
    const { container } = render(
      <ProjectSettings project={project} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    const details = container.querySelector(
      "details.sync-rules-help",
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("Manual sync rulesの書き方の例"));
    expect(details.open).toBe(true);
    expect(screen.getByText(/"source": "question"/)).toBeInTheDocument();
    expect(screen.getByText(/"template":/)).toBeInTheDocument();
    expect(screen.getByText(/自動実行されません/)).toBeInTheDocument();
  });
});
