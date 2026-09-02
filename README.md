# Dataset Studio

Dataset Studio は、任意スキーマの JSONL データセットをローカルPCで安全に確認・検索・編集・検証・復元・エクスポートするための Django + React アプリです。元ファイルは直接変更せず、import 時のJSONと編集中のJSONをSQLiteへ分けて保存します。

## Features

- ブラウザupload、ローカルパス、Hugging Face Datasetからのstreaming import
- object、array、異種型、未知fieldに対応する再帰的Dynamic Editor
- `role` / `content`を検出するmessages専用Editor（未知fieldは保持）
- pagination、仮想化一覧、全文検索、field filter、status filter
- debounce autosaveとversionによる楽観的同時実行制御
- 構造diff、record revert、soft delete / restore、duplicate
- required field、messages、型整合性、duplicate identifier検証
- user操作時だけ適用するmanual field sync
- UTF-8 JSONLのstreaming downloadとatomic local export
- Django Adminによる内部状態確認

## Setup

Python 3.11以上と [uv](https://docs.astral.sh/uv/) を用意します。

```bash
uv sync
uv run python manage.py migrate
```

SQLite DBと一時作業ファイルは通常、OS標準のApplication Data Directoryへ保存されます。開発時は`DATASET_STUDIO_DATA_DIR`または`DATASET_STUDIO_DB`で変更できます。

## Start

```bash
uv run python manage.py runserver
```

ブラウザで `http://127.0.0.1:8000` を開きます。Django development serverは既定でloopback interfaceだけにbindします。

## Admin

```bash
uv run python manage.py createsuperuser
```

`http://127.0.0.1:8000/admin/` からProject、Split、Record、Import Job、Validation結果を確認できます。

## Frontend Development

```bash
cd frontend
npm install
npm run dev
```

Viteは`/api`を`http://127.0.0.1:8000`へproxyします。

## Production Frontend Build

```bash
cd frontend
npm run build
```

生成済み`frontend/dist`はDjango staticfilesから配信されます。通常利用者はNode.jsを必要としません。

## Quality checks

```bash
uv run pytest
uv run ruff check .
cd frontend
npm run test
npm run lint
npm run typecheck
npm run build
```

10万件のsynthetic datasetは次で生成できます。

```bash
uv run python scripts/generate_test_dataset.py --records 100000
```

## Data Safety

元JSONLをデフォルトで上書きしません。不正なimport行はline番号とpreviewを伴って失敗し、黙ってskipしません。編集では未知field、messages内の追加field、値の型、ID、record順序を勝手に変更せず、exportにはDataset Studioの内部metadataを含めません。
