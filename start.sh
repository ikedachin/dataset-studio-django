#!/bin/sh
set -eu

# Always run from the project directory.
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_DIR"

if ! command -v uv >/dev/null 2>&1; then
    printf '%s\n' 'エラー: uv が必要です。https://docs.astral.sh/uv/ からインストールしてください。' >&2
    exit 1
fi

printf '%s\n' '依存関係を確認しています...'
uv sync --locked

printf '%s\n' 'DBマイグレーションを適用しています...'
uv run --no-sync python manage.py migrate --noinput

printf '%s\n' 'Dataset Studio を起動します。終了するには Ctrl+C を押してください。'
exec uv run --no-sync python manage.py runserver "$@"
