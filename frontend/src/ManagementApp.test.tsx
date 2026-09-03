import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagementApp from "./ManagementApp";

const resourcesPayload = {
  data: {
    projects: [
      {
        id: 1,
        name: "Project A",
        guardId: "default/Project A",
        isProtected: false,
        deletedAt: null,
        splits: [
          {
            id: 10,
            name: "train",
            projectId: 1,
            projectName: "Project A",
            isProtected: false,
            isInheritedProtected: false,
            isEffectivelyProtected: false,
            deletedAt: null,
          },
        ],
      },
    ],
    deletedProjects: [],
    deletedSplits: [],
  },
};

const logsPayload = {
  data: [
    {
      id: 1,
      targetType: "project",
      targetId: "default/Project A",
      action: "protect",
      confirmationText: "default/Project A",
      result: "success",
      message: "",
      actor: "local-user",
      executedAt: "2026-09-03T00:00:00+09:00",
    },
  ],
};

function okJson(payload: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

describe("ManagementApp", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("runs a project action when confirmation text matches", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/management/resources/") return okJson(resourcesPayload);
      if (url === "/api/management/audit-logs/") return okJson(logsPayload);
      if (url === "/api/management/projects/1/actions/" && init?.method === "POST") {
        return okJson({ data: { id: 1 } });
      }
      return okJson({ data: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ManagementApp />
      </QueryClientProvider>,
    );
    const card = await screen.findByTestId("project-card-1");
    const input = within(card).getAllByPlaceholderText(
      "Type exact confirmation text",
    )[0];
    fireEvent.change(input, { target: { value: "default/Project A" } });
    fireEvent.click(
      within(card).getAllByRole("button", { name: "Logical delete" })[0],
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/management/projects/1/actions/",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            action: "soft_delete",
            confirmation_text: "default/Project A",
          }),
        }),
      ),
    );
  });

  it("keeps action buttons disabled when confirmation is missing or mismatched", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/management/resources/") return okJson(resourcesPayload);
      return okJson(logsPayload);
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ManagementApp />
      </QueryClientProvider>,
    );
    const card = await screen.findByTestId("project-card-1");
    const logicalDelete = within(card).getAllByRole("button", {
      name: "Logical delete",
    })[0];
    expect(logicalDelete).toBeDisabled();
    const input = within(card).getAllByPlaceholderText(
      "Type exact confirmation text",
    )[0];
    fireEvent.change(input, { target: { value: "default/Project B" } });
    expect(logicalDelete).toBeDisabled();
  });

  it("shows audit logs", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/management/resources/") return okJson(resourcesPayload);
      return okJson(logsPayload);
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ManagementApp />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Audit logs/)).toBeInTheDocument();
    expect(await screen.findByText(/project:default\/Project A/)).toBeInTheDocument();
    expect(await screen.findByText(/local-user/)).toBeInTheDocument();
    expect((await screen.findAllByText("Active projects")).length).toBeGreaterThan(
      0,
    );
    const card = await screen.findByTestId("project-card-1");
    const statusRow = card.querySelector(".status-row");
    expect(statusRow?.textContent).toContain("unprotected");
    expect(statusRow?.textContent).toContain("active");
  });
});
