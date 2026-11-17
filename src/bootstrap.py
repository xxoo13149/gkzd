#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bootstrap.py — 从线上「零子资源单文件」自举恢复整个本地项目（跨沙箱）。

背景
----
定时任务跑在独立 sandbox_agent runtime，/workspace 不保证有 /workspace/gkzd
源码与打包流水线；本次「全新环境」就是这样来的。线上单文件由 build.py 打包时
把完整恢复包（base64 zip）嵌进 HTML 注释，因此**分享链接本身是唯一跨沙箱
持久的真相源**：页面、traces 数据、CSS/JS、同步脚本、设计约定都在里面。

用法
----
  python3 bootstrap.py --from-file <单文件.html> [--root /workspace/gkzd]
  python3 bootstrap.py --from-url  <分享链接>   [--root ...]
  python3 bootstrap.py --check                  # 只体检本地目录，不写文件

退出码非 0 表示恢复失败；调用方必须如实报错终止，
**不得手工改部署文件**（会产生与流水线不一致的线上版本）。

自校验：用恢复出来的 build.py 重新打包，必须与输入单文件逐字节一致。
"""
import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

DEFAULT_ROOT = "/workspace/gkzd"
DEFAULT_SITE = "/workspace/gkzd-site"
BEGIN = "<!-- LSF-BOOTSTRAP-BEGIN"
END = "LSF-BOOTSTRAP-END -->"
SLOT = "<!-- LSF-BOOTSTRAP-SLOT -->"
PAT = re.compile(re.escape(BEGIN) + r"\s*(.*?)\s*" + re.escape(END), re.S)

REQUIRED = [
    "index.html", "styles.css", "app.js", "config.js", "traces.js",
    "build.py", "sync_ima.py", "bootstrap.py", "DESIGN.md",
    ".lsf/task-prompt.txt",
    "assets/vendor/gsap.min.js", "assets/vendor/ScrollTrigger.min.js",
    "assets/vendor/lenis.min.js", "assets/vendor/lucide.min.js",
]


def log(msg):
    print("[bootstrap] " + msg, file=sys.stderr, flush=True)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def extract(html_bytes):
    m = PAT.search(html_bytes.decode("utf-8", "replace"))
    if not m:
        raise RuntimeError("单文件里没有 LSF-BOOTSTRAP 恢复包，无法自举")
    try:
        raw = base64.b64decode(m.group(1), validate=True)
        z = zipfile.ZipFile(io.BytesIO(raw))
    except Exception as e:
        raise RuntimeError("恢复包解码失败: " + str(e)[:120])
    return z


def restore(html_bytes, root, site):
    z = extract(html_bytes)
    names = z.namelist()
    missing = [f for f in REQUIRED if f not in names]
    if missing:
        raise RuntimeError("恢复包缺文件: " + repr(missing))
    os.makedirs(root, exist_ok=True)
    os.makedirs(site, exist_ok=True)
    for n in names:
        p = os.path.join(root, n)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        data = z.read(n)
        # 源 index.html 必须保留 SLOT 占位，打包时才能重新生成恢复包
        if n == "index.html":
            data = PAT.sub(SLOT, data.decode("utf-8")).encode("utf-8")
        open(p, "wb").write(data)
    # 部署目录逐字节等于线上单文件（不重新发布、不换链接）
    open(os.path.join(site, "index.html"), "wb").write(html_bytes)
    return names


def selfcheck(root, html_bytes):
    """用恢复出来的 build.py 重新打包，必须与输入单文件逐字节一致。"""
    os.environ["GK_SRC"] = root
    os.environ["GK_SITE"] = os.path.join(os.path.dirname(root), "gkzd-site")
    sys.path.insert(0, root)
    sys.modules.pop("build", None)
    import build
    html, _ = build.build_html()
    rebuilt = html.encode("utf-8")
    return {"rebuild_match": rebuilt == html_bytes,
            "rebuild_bytes": len(rebuilt), "online_bytes": len(html_bytes)}


def check(root):
    missing = [f for f in REQUIRED if not os.path.exists(os.path.join(root, f))]
    return {"root": root, "complete": not missing, "missing": missing,
            "files_present": len(REQUIRED) - len(missing)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-file")
    ap.add_argument("--from-url")
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--site", default=DEFAULT_SITE)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    if a.check:
        r = check(a.root)
        print(json.dumps(r, ensure_ascii=False))
        return 0 if r["complete"] else 1

    if not a.from_file and not a.from_url:
        print(json.dumps({"error": "需要 --from-file 或 --from-url"}, ensure_ascii=False))
        return 2
    try:
        if a.from_url:
            with urllib.request.urlopen(a.from_url, timeout=30) as r:
                html_bytes = r.read()
        else:
            html_bytes = open(a.from_file, "rb").read()
    except Exception as e:
        print(json.dumps({"error": "取线上单文件失败: " + str(e)[:160]}, ensure_ascii=False))
        return 2

    try:
        names = restore(html_bytes, a.root, a.site)
        chk = selfcheck(a.root, html_bytes)
    except Exception as e:
        print(json.dumps({"error": "自举失败: " + str(e)[:200]}, ensure_ascii=False))
        return 2

    out = {"restored": True, "files": len(names), "root": a.root, "site": a.site,
           "online_sha256": sha(html_bytes), **chk, "check": check(a.root)}
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if chk["rebuild_match"] and out["check"]["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
