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
vi.mock("./components/RecordList", () => ({ RecordList: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(total = 550) {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/projects/") return [{ id: 1, name: "Test", syncRules: [] }];
    if (path === "/projects/1/splits/")
      return [
        { id: 1, name: "train", datasetName: "Test", recordCount: total },
      ];
    if (path.startsWith("/splits/1/records/")) {
      const params = new URL(path, "http://localhost").searchParams;
      const offset = Number(params.get("offset"));
      const count = params.get("search") ? 1 : total;
      return {
        items: Array.from(
          { length: Math.max(0, Math.min(500, count - offset)) },
          (_, i) => ({ id: offset + i + 1 }),
        ),
        total: count,
        offset,
        limit: 500,
      };
    }
    if (path.endsWith("/diff/")) return [];
    const id = Number(path.split("/")[2]);
    return {
      id,
      position: id,
      preview: `Item ${id}`,
      data: {},
      version: 1,
      status: "unedited",
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
