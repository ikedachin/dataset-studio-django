# Dataset Studio

Dataset Studio は、任意スキーマの JSONL データセットをローカルPCで安全に確認・検索・編集・検証・復元・エクスポートするための Django + React アプリです。元ファイルは直接変更せず、import 時のJSONと編集中のJSONをSQLiteへ分けて保存します。

## Features

- ブラウザupload、ローカルパス、Hugging Face Datasetからのstreaming import
- object、array、異種型、未知fieldに対応する再帰的Dynamic Editor
- レコード直下の主要field/その他fieldを左右に分ける2カラムEditor
- `role` / `content`を検出するmessages専用Editor（未知fieldは保持）
- field pathごとに手動変更したtextareaの高さをブラウザへ保存
- Record ListとDiff/Validation panelの横幅をドラッグまたは矢印キーで調整・保存
- pagination、仮想化一覧、全文検索、field filter、status filter
- debounce autosaveとversionによる楽観的同時実行制御
- 構造diff、record revert、soft delete / restore、duplicate
- required field、messages、型整合性、duplicate identifier検証
- user操作時だけ適用するmanual field sync
- UTF-8 JSONLのstreaming downloadとatomic local export
- `/management` での Project / split 保護、論理削除、物理削除、監査ログ
- Django Adminによる内部状態確認

## Setup

Python 3.11以上と [uv](https://docs.astral.sh/uv/) を用意します。

```bash
uv sync
uv run python manage.py migrate
```

SQLite DBはデフォルトでプロジェクト直下の`dataset-studio.sqlite3`へ保存されます。一時作業ファイルはOS標準のApplication Data Directoryを使用します。DBの保存先は`DATASET_STUDIO_DB`で変更できます。

## Start

```bash
uv run python manage.py runserver
```

ブラウザで `http://127.0.0.1:8000` を開きます。Django development serverは既定でloopback interfaceだけにbindします。

管理機能は `http://127.0.0.1:8000/management` で開けます（ローカル用途のため認証なし）。

## Admin

```bash
uv run python manage.py createsuperuser
```

`http://127.0.0.1:8000/admin/` からProject、Split、Record、Import Job、Validation結果を確認できます。

## Manual sync rules

Manual sync rulesは、同じRecord内のfield間で値を手動同期するためのProject設定です。画面右上のSettingsを開き、`Manual sync rules`へJSON配列として設定します。

Syncは自動実行されません。Record編集画面の`Sync`を押すとBefore/AfterのPreviewが表示され、確認後にApplyした場合だけRecordへ反映されます。

### fieldをそのままコピーする

`source`の値を`target`へそのままコピーします。string以外の型も維持されます。

```json
[
  {
    "source": "question",
    "target": "messages[0].content"
  }
]
```

この例では、`question`の値を`messages`配列の先頭要素の`content`へコピーします。

### templateで複数fieldを組み立てる

`template`内で`{{ JSON_PATH }}`形式のplaceholderを使用できます。

```json
[
  {
    "template": "<think>{{ thinking }}</think>\n{{ answer }}",
    "target": "messages[1].content"
  }
]
```

この例では、`thinking`と`answer`を組み合わせたstringを、2番目のmessageの`content`へ設定します。

複数ruleを順番に実行することもできます。

```json
[
  {
    "source": "question",
    "target": "messages[0].content"
  },
  {
    "template": "<think>{{ thinking }}</think>\n{{ answer }}",
    "target": "messages[1].content"
  }
]
```

JSON pathの例:

- `question`: Record直下のfield
- `metadata.source`: nested object内のfield
- `messages[0].content`: arrayの先頭要素内のfield
- `items[2].label`: arrayの3番目の要素内のfield

注意点:

- `target`の親objectやarray要素は、Sync実行前に存在している必要があります。
- `source`が存在しない場合は`null`、template内のplaceholderが存在しない場合は空文字列として扱われます。
- template方式ではplaceholderの値はstringへ変換されます。型を維持したい場合は`source`方式を使用してください。
- Ruleは記載順に適用されるため、必ずPreviewで変更内容を確認してください。

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
