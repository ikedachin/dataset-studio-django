import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--records", type=int, default=100_000)
    parser.add_argument("--output", type=Path, default=Path("test-100k.jsonl"))
    args = parser.parse_args()
    with args.output.open("w", encoding="utf-8") as output:
        for index in range(args.records):
            record = {
                "id": f"sample-{index:06d}",
                "question": f"今治市についての質問 {index}",
                "metadata": {"source": "synthetic", "score": (index % 100) / 100},
                "messages": [
                    {"role": "user", "content": f"質問 {index}"},
                    {"role": "assistant", "content": f"回答 {index}"},
                ],
            }
            output.write(json.dumps(record, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
