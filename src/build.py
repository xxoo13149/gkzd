#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — 把结构化源文件打包成「零子资源」的单文件 index.html。

背景（2026-11-11 定位）
----------------------
发布平台的分享链接靠根 URL 的 sharecode 种下
  Set-Cookie: __wb_rsc=...; SameSite=None; Secure; HttpOnly
之后所有子资源（styles.css / *.js / assets/vendor/*）都必须带这个 cookie
才放行，否则返回 403「链接不完整」。iPad Safari(ITP) 与多数移动 WebView
会拦截这类第三方 cookie，导致 CSS/JS 全部加载失败、页面只剩骨架，
格历退化成竖排单列。桌面浏览器会正常回传 cookie，所以此前验证一直全绿。

解决：把 CSS 与全部 JS 内联进主文档，页面不再发出任何子资源请求。
无论 cookie、缓存、WebView、App 预览通道如何，都完整渲染。

跨沙箱自举（2026-11-13 新增）
----------------------------
定时任务跑在独立 sandbox_agent runtime，/workspace 不保证有项目源码与
打包流水线（本次「全新环境」即如此）。因此打包时把**完整恢复包**
（源码 + 7 个 JS + CSS + build.py / sync_ima.py / bootstrap.py + DESIGN.md
 + 任务指令）打成 base64 zip 嵌进 HTML 注释。线上单文件于是成为唯一
跨沙箱持久的真相源：任何新会话 curl 该链接即可用 bootstrap.py 完整恢复。
注释不执行、不产生 DOM、不影响渲染与零子资源判定。

产物：/workspace/gkzd-site/index.html（单文件；链接不变）
源目录 /workspace/gkzd/ 保留结构化文件，供维护与定时任务改 traces.js。
定时任务通过 sync_ima.py deploy() 调用本模块，不要手工改部署目录。
"""
import base64
import io
import json
import os
import re
import sys
import zipfile

# 允许 bootstrap.py 在临时目录自校验时覆盖（不影响正式路径）
SRC = os.environ.get("GK_SRC", "/workspace/gkzd")
SITE = os.environ.get("GK_SITE", "/workspace/gkzd-site")

# 顺序必须与 index.html 里 script 引用一致（vendor → config → traces → app）
SCRIPTS = [
    "assets/vendor/gsap.min.js",
    "assets/vendor/ScrollTrigger.min.js",
    "assets/vendor/lenis.min.js",
    "assets/vendor/lucide.min.js",
    "config.js",
    "traces.js",
    "app.js",
]

# 恢复包内容：页面能跑起来的全部源文件 + 流水线 + 设计约定 + 任务指令
BOOTSTRAP_FILES = [
    "index.html", "styles.css", "app.js", "config.js", "traces.js",
    "build.py", "sync_ima.py", "bootstrap.py", "DESIGN.md",
    ".lsf/task-prompt.txt",
    "assets/vendor/gsap.min.js", "assets/vendor/ScrollTrigger.min.js",
    "assets/vendor/lenis.min.js", "assets/vendor/lucide.min.js",
]

BOOTSTRAP_BEGIN = "<!-- LSF-BOOTSTRAP-BEGIN"
BOOTSTRAP_END = "LSF-BOOTSTRAP-END -->"
BOOTSTRAP_SLOT = "<!-- LSF-BOOTSTRAP-SLOT -->"


def _read(rel):
    return open(os.path.join(SRC, rel), encoding="utf-8").read()


def bootstrap_blob():
    """把完整源文件打成 base64 zip。用 writestr 固定条目元数据，保证内容不变则字节不变。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in BOOTSTRAP_FILES:
            p = os.path.join(SRC, rel)
            if not os.path.exists(p):
                raise RuntimeError("恢复包缺文件: " + rel)
            # 固定 DOS 时间戳：writestr(字符串) 默认写当前时刻，
            # zip 头随打包时间变化 → 单文件字节不确定 → files_differ()
            # 永远判定「过期」，定时任务「无新增不发版」的判断也会失真。
            zi = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, open(p, "rb").read())
    return base64.b64encode(buf.getvalue()).decode("ascii")


def embed_bootstrap(html):
    blob = bootstrap_blob()
    block = BOOTSTRAP_BEGIN + "\n" + blob + "\n" + BOOTSTRAP_END
    if html.count(BOOTSTRAP_SLOT) != 1:
        raise RuntimeError("index.html 必须恰好有一个 LSF-BOOTSTRAP-SLOT 占位，实际 %d 处"
                           % html.count(BOOTSTRAP_SLOT))
    return html.replace(BOOTSTRAP_SLOT, block, 1), len(blob)


def build_html():
    """返回 (单文件 HTML, 打包统计)。不写磁盘，便于 hash 比对与测试。"""
    html = _read("index.html")
    css = _read("styles.css")

    # 1) 外链 CSS → 内联
    link_pat = r'<link\s+rel="stylesheet"\s+href="styles\.css(?:\?[^"]*)?"\s*/?>'
    html, n_css = re.subn(
        link_pat,
        lambda m: '<style id="inline-css">\n' + css.replace("</style", "<\\/style") + "\n</style>",
        html,
    )
    if n_css != 1:
        raise RuntimeError("找不到唯一的 styles.css 引用，实际 %d 处" % n_css)

    # 2) 每个 <script src> → 内联（防止内容里的 </script 提前闭合标签）
    inlined = []
    for rel in SCRIPTS:
        pat = r'<script\s+src="' + re.escape(rel) + r'(?:\?[^"]*)?"\s*>\s*</script>'
        src = _read(rel).replace("</script", "<\\/script")
        replacement = '<script data-inline="%s">\n%s\n</script>' % (rel, src)
        html, n = re.subn(pat, lambda m, r=replacement: r, html)
        if n != 1:
            raise RuntimeError("找不到唯一的 script 引用 %s，实际 %d 处" % (rel, n))
        inlined.append({"file": rel, "bytes": len(src.encode("utf-8"))})

    # 3) 校验：页面不得再引用任何本地相对资源
    leftovers = [
        u for u in re.findall(r'(?:src|href)="([^"]+)"', html)
        if not (u.startswith("#") or u.startswith("data:") or u.startswith("http") or u.startswith("//"))
    ]
    # 锚点与 data URI 之外，允许 favicon 的 data:；其余一律视为漏网
    if leftovers:
        raise RuntimeError("仍存在本地子资源引用: " + repr(leftovers[:10]))

    html = html.replace(
        "<head>",
        '<head>\n<!-- single-file build: zero subresources; cookie-free on iPad/mobile -->',
        1,
    )

    # 4) 嵌入跨沙箱恢复包（HTML 注释，浏览器不执行、不产生 DOM、无子资源）
    html, blob_bytes = embed_bootstrap(html)

    stats = {
        "total_bytes": len(html.encode("utf-8")),
        "inline_css_bytes": len(css.encode("utf-8")),
        "inline_scripts": inlined,
        "subresource_refs": leftovers,
        "bootstrap_bytes": blob_bytes,
        "bootstrap_files": len(BOOTSTRAP_FILES),
    }
    return html, stats


def build():
    html, stats = build_html()
    os.makedirs(SITE, exist_ok=True)
    out = os.path.join(SITE, "index.html")
    open(out, "w", encoding="utf-8").write(html)
    return out, stats


if __name__ == "__main__":
    out, stats = build()
    print(json.dumps({"output": out, **stats}, ensure_ascii=False, indent=2))
