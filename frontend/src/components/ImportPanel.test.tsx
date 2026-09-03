import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ImportPanel } from "./ImportPanel";

vi.mock("../api/client", () => ({
  api: vi.fn(),
  jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
}));
const mockApi = vi.mocked(api);
const project = {
  id: 1,
  name: "HF",
  sourceType: "huggingface" as const,
  inferredSchema: {},
  syncRules: [],
  identifierFields: [],
  validationSettings: {},
};
const info = {
  configurations: ["default"],
  configuration: "default",
  splits: ["train", "valid"],
};
const job = (id: number, split: string, status = "pending") => ({
  id,
  split,
  status,
  current: status === "completed" ? 1 : 0,
  total: null,
  percent: null,
  error: {},
});
const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};
const change = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};
const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(701);
  });
};
const load = async () => {
  await change("Dataset repository", "owner/data");
  await click(screen.getByRole("button", { name: "Load dataset information" }));
};
beforeEach(() => {
  vi.useFakeTimers();
  mockApi.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Hugging Face import", () => {
  it("selects all splits and sends selected splits and credentials in the body", async () => {
    mockApi
      .mockResolvedValueOnce(info)
      .mockResolvedValueOnce({ jobs: [job(1, "valid")] });
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    );
    await change("HF_TOKEN (optional)", "hf_browser");
    await change("Revision (optional)", "v1");
    await load();
    expect(screen.getByLabelText("HF_TOKEN (optional)")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("train")).toBeChecked();
    expect(screen.getByLabelText("valid")).toBeChecked();
    await click(screen.getByLabelText("train"));
    await click(screen.getByRole("button", { name: "Start import" }));
    const [url, init] = mockApi.mock.calls[1];
    expect(url).toBe("/import/huggingface/batch/");
    expect(JSON.parse(init?.body as string)).toEqual({
      project_id: 1,
      dataset_name: "owner/data",
      repository: "owner/data",
      revision: "v1",
      configuration: "default",
      splits: ["valid"],
      hf_token: "hf_browser",
    });
    expect(screen.queryByDisplayValue("hf_browser")).not.toBeInTheDocument();
    expect(storage).not.toHaveBeenCalled();
  });

  it("requires a configuration choice and handles validation-only datasets", async () => {
    mockApi
      .mockResolvedValueOnce({
        configurations: ["en", "ja"],
        configuration: null,
        splits: [],
      })
      .mockResolvedValueOnce({
        configurations: ["en", "ja"],
        configuration: "ja",
        splits: ["validation"],
      });
    render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    );
    await load();
    expect(screen.getByRole("button", { name: "Start import" })).toBeDisabled();
    await change("Configuration", "ja");
    expect(screen.getByLabelText("validation")).toBeChecked();
    expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled();
    expect(
      JSON.parse(mockApi.mock.calls[1][1]?.body as string).configuration,
    ).toBe("ja");
  });

  it.each(["Dataset repository", "Revision (optional)", "HF_TOKEN (optional)"])(
    "invalidates metadata when %s changes",
    async (label) => {
      mockApi.mockResolvedValue(info);
      render(
        <ImportPanel
          project={project}
          onClose={vi.fn()}
          onComplete={vi.fn()}
        />,
      );
      await load();
      await change(label, "changed");
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Start import" }),
      ).toBeDisabled();
    },
  );

  it("ignores stale metadata responses after input changes", async () => {
    let resolve!: (value: unknown) => void;
    mockApi.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    );
    await load();
    await change("Dataset repository", "other/data");
    await act(async () => {
      resolve(info);
    });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start import" })).toBeDisabled();
  });

  it("prevents duplicate submission and input changes while starting jobs", async () => {
    mockApi
      .mockResolvedValueOnce(info)
      .mockImplementationOnce(() => new Promise(() => {}));
    render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    );
    await load();
    const button = screen.getByRole("button", { name: "Start import" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mockApi).toHaveBeenCalledTimes(2);
    expect(button).toBeDisabled();
    expect(screen.getByLabelText("HF_TOKEN (optional)")).toBeDisabled();
    expect(screen.getByLabelText("Revision (optional)")).toBeDisabled();
  });

  it("keeps completed splits and retries failed splits with a re-entered token", async () => {
    const complete = vi.fn();
    mockApi.mockImplementation(async (url) => {
      if (url === "/huggingface/info/") return info;
      if (url === "/import/huggingface/batch/")
        return { jobs: [job(1, "train"), job(2, "valid")] };
      if (url === "/jobs/1/") return job(1, "train", "completed");
      return {
        ...job(2, "valid", "failed"),
        error: { message: "Check HF_TOKEN" },
      };
    });
    render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={complete} />,
    );
    await change("HF_TOKEN (optional)", "hf_old");
    await load();
    await click(screen.getByRole("button", { name: "Start import" }));
    await tick();
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByText("Check HF_TOKEN")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "Retry failed splits" }));
    expect(screen.getByLabelText("HF_TOKEN (optional)")).toHaveValue("");
    await change("HF_TOKEN (optional)", "hf_retry");
    await click(
      screen.getByRole("button", { name: "Load dataset information" }),
    );
    expect(
      screen.getByLabelText("train (not part of this retry)"),
    ).toBeDisabled();
    expect(screen.getByLabelText("valid")).toBeChecked();
    mockApi.mockResolvedValueOnce({ jobs: [job(3, "valid")] });
    await click(screen.getByRole("button", { name: "Start import" }));
    const body = JSON.parse(mockApi.mock.calls.at(-1)![1]?.body as string);
    expect(body.splits).toEqual(["valid"]);
    expect(body.hf_token).toBe("hf_retry");
    mockApi.mockResolvedValueOnce(job(3, "valid", "completed"));
    await tick();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("shows polling errors and resumes progress updates", async () => {
    mockApi
      .mockResolvedValueOnce(info)
      .mockResolvedValueOnce({ jobs: [job(1, "train")] })
      .mockRejectedValueOnce(new Error("offline"));
    const complete = vi.fn();
    render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={complete} />,
    );
    await load();
    await click(screen.getByRole("button", { name: "Start import" }));
    await tick();
    expect(screen.getByRole("alert")).toHaveTextContent("may still be running");
    mockApi.mockResolvedValueOnce(job(1, "train", "completed"));
    await click(
      screen.getByRole("button", { name: "Resume progress updates" }),
    );
    await tick();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("stops polling on unmount without cancelling the server job", async () => {
    mockApi
      .mockResolvedValueOnce(info)
      .mockResolvedValueOnce({ jobs: [job(1, "train")] });
    const { unmount } = render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    );
    await load();
    await click(screen.getByRole("button", { name: "Start import" }));
    unmount();
    await tick();
    expect(mockApi).toHaveBeenCalledTimes(2);
  });

  it("allows metadata retrieval to be retried after an error", async () => {
    mockApi
      .mockRejectedValueOnce(new Error("Access denied"))
      .mockResolvedValueOnce(info);
    render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    );
    await load();
    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
    await click(
      screen.getByRole("button", { name: "Load dataset information" }),
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});

describe("Dataset names across import methods", () => {
  it.each(["upload", "local", "huggingface"] as const)(
    "sends an explicit dataset name for %s",
    async (source) => {
      mockApi.mockImplementation(async (url) =>
        url === "/huggingface/info/"
          ? info
          : source === "huggingface"
            ? {
                jobs: [
                  { ...job(1, "train"), datasetName: "My second dataset" },
                ],
              }
            : job(1, "train"),
      );
      render(
        <ImportPanel
          project={{ ...project, sourceType: source }}
          onClose={vi.fn()}
          onComplete={vi.fn()}
        />,
      );
      await change("Dataset name", "My second dataset");
      if (source === "huggingface") await load();
      if (source === "local")
        await change("Absolute file path", "/datasets/source.jsonl");
      if (source === "upload") {
        await act(async () => {
          fireEvent.change(screen.getByLabelText("JSONL file"), {
            target: {
              files: [new File(['{"text":"hello"}\n'], "source.jsonl")],
            },
          });
        });
        expect(mockApi).not.toHaveBeenCalled();
      }
      expect(screen.getByLabelText("Dataset name")).toHaveValue(
        "My second dataset",
      );
      await click(screen.getByRole("button", { name: "Start import" }));
      const body = mockApi.mock.calls.at(-1)![1]?.body;
      expect(
        body instanceof FormData
          ? body.get("dataset_name")
          : JSON.parse(body as string).dataset_name,
      ).toBe("My second dataset");
    },
  );

  it.each(["upload", "local"] as const)(
    "defaults %s dataset names from the selected file",
    async (source) => {
      render(
        <ImportPanel
          project={{ ...project, sourceType: source }}
          onClose={vi.fn()}
          onComplete={vi.fn()}
        />,
      );
      if (source === "local")
        await change("Absolute file path", "/datasets/another-dataset.jsonl");
      else
        await act(async () => {
          fireEvent.change(screen.getByLabelText("JSONL file"), {
            target: { files: [new File(["{}"], "another-dataset.jsonl")] },
          });
        });
      expect(screen.getByLabelText("Dataset name")).toHaveValue(
        "another-dataset",
      );
    },
  );

  it("includes non-default configurations in the default dataset name", async () => {
    mockApi.mockResolvedValue({
      configurations: ["ja"],
      configuration: "ja",
      splits: ["train"],
    });
    render(
      <ImportPanel project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    );
    await load();
    expect(screen.getByLabelText("Dataset name")).toHaveValue("owner/data/ja");
  });
});
