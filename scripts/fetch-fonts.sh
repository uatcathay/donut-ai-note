#!/bin/bash
# 重新抓取自架字體（Azeret Mono 英數字、Noto Sans TC 中文）到 public/fonts/，
# 並產生 public/fonts.css。字體檔已納入版控，平常不需要執行；
# 要換字體或更新版本時才跑。
#
# 為什麼自架而不連 Google CDN：這是開會時用的本機工具，網路不穩不該連字體都載不到；
# 而且字體請求會把使用者的瀏覽行為送到第三方。代價是 4.2MB 進版控。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FONT_DIR="$PROJECT_DIR/public/fonts"
# Google Fonts 依 User-Agent 決定回傳格式；舊的 UA 會拿到 ttf 而非 woff2
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsS -A "$UA" \
  "https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@400;700&display=swap" \
  -o "$WORK/azeret.css"
curl -fsS -A "$UA" \
  "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap" \
  -o "$WORK/noto.css"

mkdir -p "$FONT_DIR"
grep -ho 'https://fonts.gstatic.com[^)]*' "$WORK"/*.css | sort -u > "$WORK/urls.txt"
echo "下載 $(wc -l < "$WORK/urls.txt" | tr -d ' ') 個字體檔…"
while read -r url; do
  curl -fsS -o "$FONT_DIR/$(basename "$url")" "$url" &
done < "$WORK/urls.txt"
wait

# 下載失敗時 Google 會回 HTML；woff2 的檔頭必為 wOF2，藉此擋下壞檔
for f in "$FONT_DIR"/*.woff2; do
  if [ "$(head -c4 "$f")" != "wOF2" ]; then
    echo "錯誤：$f 不是有效的 woff2，請重跑" >&2
    exit 1
  fi
done

{
  echo "/* 由 scripts/fetch-fonts.sh 產生，請勿手動編輯。 */"
  echo
  for f in "$WORK/azeret.css" "$WORK/noto.css"; do
    sed -E 's#url\(https://fonts\.gstatic\.com[^)]*/([^/)]+)\)#url(/fonts/\1)#g' "$f"
    echo
  done
} > "$PROJECT_DIR/public/fonts.css"

echo "完成：$(ls "$FONT_DIR" | wc -l | tr -d ' ') 個字體檔，$(du -sh "$FONT_DIR" | cut -f1)"
