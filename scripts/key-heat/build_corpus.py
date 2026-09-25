#!/usr/bin/env python3
"""青空文庫『こころ』『坊っちゃん』を、新月配列の打鍵頻度集計用のかなコーパスに変換する。

再現手順:
  pip install mecab-python3 unidic-lite
  python3 scripts/key-heat/build_corpus.py <出力先ディレクトリ>

- 出力: <出力先>/corpus.kana.txt（ひらがな・ー・、。のみ。ゐ→い、ゑ→え）
- 読みは MeCab (unidic-lite) の「仮名」素性（表層形の読み）を使う。未知語は表層形。
- ルビ《》・注記［＃］・〔〕・底本情報は除去する。
- 数字・英字・記号・「」はコーパスに含めない（打てない配列との公平のため、統一ベンチマークと同じ扱い）。
"""
import io
import pathlib
import re
import sys
import urllib.request
import zipfile

import MeCab

WORKS = [
    {"key": "kokoro", "title": "こころ", "author": "夏目漱石", "card": "https://www.aozora.gr.jp/cards/000148/card773.html",
     "zip": "https://www.aozora.gr.jp/cards/000148/files/773_ruby_5968.zip", "file": "kokoro.txt"},
    {"key": "bocchan", "title": "坊っちゃん", "author": "夏目漱石", "card": "https://www.aozora.gr.jp/cards/000148/card752.html",
     "zip": "https://www.aozora.gr.jp/cards/000148/files/752_ruby_2438.zip", "file": "bocchan.txt"},
]
KANA_FIELD = 17  # unidic の素性 CSV で「仮名」（表層形の読み。呼ん→ヨン、先生→センセイ）が入る位置
KEEP = re.compile(r"[ぁ-ゖー、。]")


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url) as res:
        return res.read()


def decode(b: bytes) -> str:
    for enc in ("cp932", "shift_jis", "utf-8"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            continue
    raise SystemExit("decode failed")


def strip_aozora(t: str) -> str:
    parts = t.split("-------------------------------------------------------")
    if len(parts) >= 3:
        t = parts[2]
    t = t.split("底本：")[0]
    t = re.sub(r"《.+?》", "", t)
    t = re.sub(r"［＃.+?］", "", t)
    t = re.sub(r"〔.+?〕", "", t)
    return t.replace("｜", "")


def kata_to_hira(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def to_kana(tagger: "MeCab.Tagger", t: str) -> str:
    out = []
    for line in t.splitlines():
        if not line.strip():
            continue
        node = tagger.parseToNode(line)
        while node:
            if node.surface:
                f = node.feature.split(",")
                if len(f) > KANA_FIELD and f[KANA_FIELD] not in ("", "*"):
                    y = f[KANA_FIELD]
                elif len(f) > 6 and f[6] not in ("", "*"):
                    y = f[6]
                else:
                    y = node.surface
                out.append(kata_to_hira(y))
            node = node.next
        out.append("\n")
    return "".join(out)


def main() -> None:
    out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out_dir.mkdir(parents=True, exist_ok=True)
    tagger = MeCab.Tagger()
    chunks = []
    for w in WORKS:
        zf = zipfile.ZipFile(io.BytesIO(fetch(w["zip"])))
        raw = decode(zf.read(w["file"]))
        kana = to_kana(tagger, strip_aozora(raw))
        kana = "".join(ch for ch in kana if KEEP.match(ch)).replace("ゐ", "い").replace("ゑ", "え")
        (out_dir / f"{w['key']}.kana.txt").write_text(kana, encoding="utf-8")
        chunks.append(kana)
        print(f"{w['title']}: {len(kana)} かな")
    (out_dir / "corpus.kana.txt").write_text("".join(chunks), encoding="utf-8")
    print(f"total: {sum(len(c) for c in chunks)} かな -> {out_dir / 'corpus.kana.txt'}")


if __name__ == "__main__":
    main()
