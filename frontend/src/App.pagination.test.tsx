import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api/client";

vi.mock("./api/client", () => ({
  api: vi.fn(),
  jsonBody: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock("./components/RecordList", () => ({
  RecordList: ({
    records,
    onSelect,
  }: {
    records: { id: number }[];
    onSelect: (id: number) => void;
  }) => (
    <div>
      {records
        .filter((r) => [750, 1000, 1050].includes(r.id))
        .map((r) => (
          <button key={r.id} onClick={() => onSelect(r.id)}>
            Select {r.id}
          </button>
        ))}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function setup(total = 550) {
  const deleted = new Set<number>();
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/projects/") return [{ id: 1, name: "Test", syncRules: [] }];
    if (path === "/projects/1/splits/")
      return [
        { id: 1, name: "train", datasetName: "Test", recordCount: total },
      ];
    if (path.startsWith("/splits/1/records/")) {
      const params = new URL(path, "http://localhost").searchParams;
      const offset = Number(params.get("offset"));
      const ids = Array.from({ length: total }, (_, i) => i + 1).filter(
        (id) => !deleted.has(id),
      );
      const count = params.get("search") ? 1 : ids.length;
      return {
        items: Array.from(
          { length: Math.max(0, Math.min(500, count - offset)) },
          (_, i) => ({ id: ids[offset + i] }),
        ),
        total: count,
        offset,
        limit: 500,
      };
    }
    if (path.endsWith("/diff/")) return [];
    const id = Number(path.split("/")[2]);
    if (options?.method === "DELETE") deleted.add(id);
    return {
      id,
      position: id,
      preview: `Item ${id}`,
      data: {},
      version: 1,
      status: deleted.has(id) ? "deleted" : "unedited",
      isDeleted: deleted.has(id),
    };
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

it("opens records beyond 500 and navigates back across the page boundary", async () => {
  setup();
  await screen.findByText("1–500 / 550 records");
  expect(screen.getByRole("button", { name: "前のページ" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
  await screen.findByText("501–550 / 550 records");
  await screen.findByRole("heading", { name: "Item 501" });
  expect(screen.getByText("Record 501")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "次のページ" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByRole("heading", { name: "Item 500" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Item 501" });
  fireEvent.change(screen.getByPlaceholderText("Search all fields…"), {
    target: { value: "match" },
  });
  await screen.findByText("1–1 / 1 records");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "前のページ" })).toBeDisabled(),
  );
});

it("disables both arrows for an empty dataset", async () => {
  setup(0);
  await screen.findByRole("navigation", { name: "レコードのページ切り替え" });
  expect(screen.getByRole("button", { name: "前のページ" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "次のページ" })).toBeDisabled();
});

it.each([750, 1000, 1050])(
  "moves to the successor of deleted record %i instead of the page start",
  async (id) => {
    setup(1100);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await screen.findByText("1–500 / 1,100 records");
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await screen.findByText("501–1,000 / 1,100 records");
    if (id > 1000) {
      fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
      await screen.findByText("1,001–1,100 / 1,100 records");
    }
    fireEvent.click(screen.getByRole("button", { name: `Select ${id}` }));
    await screen.findByRole("heading", { name: `Item ${id}` });
    fireEvent.click(screen.getByTitle("Delete"));
    await screen.findByTitle("Restore");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByRole("heading", { name: `Item ${id + 1}` });
  },
);
