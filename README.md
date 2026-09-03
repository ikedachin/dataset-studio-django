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
uv run python manage.py makemigrations
uv run python manage.py migrate
```

SQLite DBはデフォルトでプロジェクト直下の`dataset-studio.sqlite3`へ保存されます。一時作業ファイルはOS標準のApplication Data Directoryを使用します。DBの保存先は`DATASET_STUDIO_DB`で変更できます。

## Start

```bash
uv run python manage.py runserver
```

ブラウザで `http://127.0.0.1:8000` を開きます。Django development serverは既定でloopback interfaceだけにbindします。

管理機能は `http://127.0.0.1:8000/management` で開けます（ローカル用途のため認証なし）。

## データセット名とsplit

すべてのインポート方法で **Dataset name** を指定できます。保存先は「プロジェクト＋データセット名＋split名」で識別するため、同じプロジェクトに `dataset-A / train` と `dataset-B / train` を保存できます。同じデータセット名・split名の既存データは上書きしません。

データセット名の初期値は、Hugging FaceではリポジトリID（Configurationが`default`以外なら`リポジトリID/Configuration`）、アップロード・ローカルパスでは拡張子を除いたファイル名です。例えば別々のデータセットがどちらも`train.jsonl`というファイル名なら、Dataset nameをそれぞれ別名に変更してください。同じデータセットへ`valid`などを追加する場合は、前回と同じDataset nameを指定します。

アップロードではファイルを選択した後、データセット名とsplit名を確認して **Start import** を押します。split選択タブ・管理画面・エクスポート画面にも所属データセット名を表示します。

既存データはマイグレーションで元のインポート情報に基づくデータセット名へ移行します。インポート情報がないsplitはプロジェクト名を使用し、split ID・レコード・保護設定は維持します。APIでは各インポートの`dataset_name`を省略すると初期値を使用し、split一覧・ジョブ応答の`datasetName`で所属先を確認できます。

## Hugging Faceからのインポート

1. Import画面で **Hugging Face** を選択し、`owner/dataset`形式のDataset repositoryを入力します。必要ならRevision（ブランチ・タグ・コミット）も指定します。
2. 非公開・アクセス制限付きデータセットでは、アクセス権のある **HF_TOKEN** を入力します。公開データセットは未入力で利用できます。未入力時はサーバーの`HF_TOKEN`、既存のHugging Face認証設定の順に利用します。
3. **Load dataset information** を押します。Configurationが複数ある場合は1つ選択してください。
4. 取り込むsplitを選択して **Start import** を押します。初期状態は全選択で、`train`・`valid`・`validation`などを元の名前のまま別々に保存します。

ブラウザで入力したトークンは、情報取得と今回の取り込みの待機・実行中だけメモリで保持します。DB、ブラウザストレージ、Hugging Faceのログイン設定には保存せず、ジョブ受付後に入力欄を消去します。リポジトリ・Revision・トークンを変更したら情報を再取得してください。

splitごとに進捗とエラーを表示します。一部が失敗しても完了済みsplitは保持し、**Retry failed splits** で失敗分だけ再実行できます。認証が必要な場合はトークンを再入力してください。同じデータセット内の同名splitに既存データがある場合、保護・論理削除されている場合、取り込みが待機・実行中の場合は上書きせず拒否します。別データセットの同名splitは取り込めます。

画面を閉じてもサーバーの取り込みは継続します。サーバーを再起動した場合は、次のジョブ照会・取り込み開始時に古いジョブを中断扱いにします。このバージョンで作成したジョブの部分データは記録した行IDに基づいて片付けます。自動再開は行いません。旧バージョンで中断したデータが残っている場合は保存先を確認してください。

対象はJSONとして保存できるレコードです。画像・音声オブジェクトなどJSONに変換できない値を含むデータセットはエラーになります。アクセス制限付きデータセットでは、トークンに加えてHugging Face上での利用承認が必要な場合があります。

APIでは`POST /api/huggingface/info/`がConfiguration・split一覧を返し、`POST /api/import/huggingface/batch/`が選択splitごとのジョブを返します。トークンは任意の`hf_token`としてJSON本文に指定します。既存の単一split APIと情報取得GET APIも利用できます。

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
