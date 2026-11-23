#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_ima.py — 公考作战台 IMA 学习痕迹同步（本地机械流程固化）

设计意图
--------
定时任务触发的是一个 Agent 会话，只让它做「需要判断」的部分：
  读 IMA 知识库 → 找出新增「学习痕迹 YYYY-MM-DD」文档 → 按 DESIGN.md
  映射规则把每篇转成一个痕迹对象 → 写成 JSON 数组文件。
剩下「容易出错、必须稳定」的部分全部固化在本脚本：
  按 date 去重 → 追加 traces.js → 刷新 index.html 静态兜底 →
  同步部署目录（覆盖即上线）→ 真实浏览器验证 → 输出 JSON 报告。

用法
----
  python3 sync_ima.py --add /tmp/new_traces.json    # 常规：有新增才发版
  python3 sync_ima.py --deploy-only                 # 源码已手工改过，只发版
  python3 sync_ima.py --check                      # 只读体检，不改动任何文件

JSON 输入格式（数组，字段缺失一律按 null 处理，不做默认值兜底）：
  [{"id":"ima-2026-11-12","date":"2026-11-12","topic":"资料分析","kind":"限时真题","type":"限时真题",
    "title":"...","body":"...","note":"...","minutes":null,
    "questions":null,"score":null,"src":"学习痕迹 2026-11-12","by":"ima"}]
  topic=板块（资料分析/数量关系/言语理解/…），kind=训练类型（限时真题/套卷/专项练习/…）；
  两者均取自知识库原文语境，源站没有明确归类时留 null，不臆造。

约定见 /workspace/gkzd/DESIGN.md「后续改动约定」。
"""
import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import build_html, build as build_single_file

SRC = os.environ.get("GK_SRC", "/workspace/gkzd")
SITE = os.environ.get("GK_SITE", "/workspace/gkzd-site")
PUBLISH_JS = "/root/.codebuddy/skills/sites/scripts/publish.js"
CHROMIUM = "/usr/bin/chromium"
LOCAL_URL = os.environ.get("GK_LOCAL_URL", "http://127.0.0.1:3000/index.html")
FILES = ["index.html", "styles.css", "app.js", "config.js", "traces.js"]

# GitHub Pages 永久发布目标（仓库即真相源，clone 即恢复）
GH_REPO = os.environ.get("GK_GH_REPO", "xxoo13149/gkzd")
GH_PAGES_URL = os.environ.get("GK_GH_PAGES_URL", "https://xxoo13149.github.io/gkzd/")
GH_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GH_DIR = os.environ.get("GK_GH_DIR", "/tmp/gkzd-gh")
# 定时任务跑在临时沙箱：不重新发布 WorkBuddy 链接（会生成新链接，正是旧版每晚"链接更新"的元凶）
SKIP_PUBLISH = os.environ.get("GK_SKIP_PUBLISH", "") == "1"

# 由 JS 渲染、需要写进静态兜底的容器
IDS = ["topDate", "calSub", "cdLine", "phaseLine", "streakLine", "calNav", "calGrid", "stats",
       "taskRing", "taskList", "quoteText", "quoteSrc", "todayFlag",
       "nextLabel", "nextDesc", "nextDate", "nextLeft", "scoreNow", "scoreTarget", "scoreGap",
       "milestoneList", "traceFilters", "traceList", "fType", "examPresets"]

FIELDS = ["id", "date", "topic", "kind", "type", "title", "body", "note", "minutes", "questions", "score", "src", "by"]


def log(msg):
    print("[sync] " + msg, file=sys.stderr, flush=True)


def js_val(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
    return "'" + s + "'"


def to_js_obj(t):
    """按 traces.js 现有排版生成单个对象字面量；取不到的字段一律 null。"""
    g = lambda k: js_val(t.get(k))
    return (
        "  {\n"
        f"    id: {g('id')}, date: {g('date')}, topic: {g('topic')}, kind: {g('kind')}, type: {g('type')},\n"
        f"    title: {g('title')},\n"
        f"    body: {g('body')},\n"
        f"    note: {g('note')},\n"
        f"    minutes: {g('minutes')}, questions: {g('questions')}, score: {g('score')},\n"
        f"    src: {g('src')}, by: {g('by')}\n"
        "  },\n"
    )


def read_existing_dates(path):
    text = open(path, encoding="utf-8").read()
    # 只解析 window.GK_TRACES = [...] 数组本体，忽略文件头注释里的示例 date
    marker = "window.GK_TRACES = ["
    body = text[text.index(marker):] if marker in text else text
    return set(re.findall(r"date:\s*'(\d{4}-\d{2}-\d{2})'", body)), text


def add_traces(json_path):
    """返回 (新增的 date 列表, 是否改动文件)。"""
    if not json_path:
        return [], False
    raw = json.load(open(json_path, encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("--add 必须是 JSON 数组")
    path = os.path.join(SRC, "traces.js")
    existing_dates, text = read_existing_dates(path)
    # 同日多条：按 id 去重（id 唯一），date 只做合法性校验，不再做唯一键。
    # 这样同一天可以有多条不同 id 的痕迹；重复触发仍因 id 已存在被跳过。
    existing_ids = set(re.findall(r"id:\s*'([^']+)'", text[text.index("window.GK_TRACES = ["):] if "window.GK_TRACES = [" in text else text))
    fresh = []
    for t in raw:
        d = t.get("date")
        if not d or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d)):
            log(f"跳过无效 date: {d!r}")
            continue
        tid = t.get("id") or f"ima-{d}"
        if tid in existing_ids:
            log(f"已存在（id 去重），跳过: {tid}")
            continue
        existing_ids.add(tid)
        existing_dates.add(d)
        fresh.append(t)
    if not fresh:
        return [], False
    # 按 date 倒序（与页面一致），插到数组最前
    fresh.sort(key=lambda x: str(x.get("date")), reverse=True)
    block = "".join(to_js_obj(t) for t in fresh)
    marker = "window.GK_TRACES = [\n"
    if marker not in text:
        raise RuntimeError("traces.js 里找不到 window.GK_TRACES = [ 起始标记")
    text = text.replace(marker, marker + block, 1)
    open(path, "w", encoding="utf-8").write(text)
    log(f"追加 {len(fresh)} 条: {[t.get('date') for t in fresh]}")
    return [t.get("date") for t in fresh], True


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]


def files_differ():
    """单文件部署：直接比较「当前源文件重新打包」与部署目录 index.html。

    发布链接靠 cookie 鉴权，子资源在 iPad/移动端会被 403 拦截，
    因此部署目录只认一个零子资源的单文件 HTML；其他文件不参与一致性判断。
    """
    try:
        html, _ = build_html()
        dst = os.path.join(SITE, "index.html")
        if not os.path.exists(dst):
            return ["index.html(单文件缺失)"]
        cur = open(dst, "rb").read()
        return [] if cur == html.encode("utf-8") else ["index.html(单文件过期)"]
    except Exception as e:
        return ["打包失败: " + str(e)[:120]]


def replace_container(html, id_, inner):
    """按同名标签配平替换容器内内容，返回新 HTML；失败返回 None。

    不能用 `(<tag id=...>)(.*?)(</tag>)` 这种非贪婪正则：
    #calGrid 内部第一个 `</div>` 是占位格自己的闭合标签，正则会在那里截断，
    导致每次刷新只换掉开头一小段、旧格子全部残留，越积越多（曾累积 8 份 42 格）。
    """
    m = re.search(r'<([a-zA-Z0-9]+)\b[^>]*\bid="' + re.escape(id_) + r'"[^>]*>', html)
    if not m:
        return None
    tag = m.group(1)
    start = m.end()
    op = re.compile(r'<' + re.escape(tag) + r'\b[^>]*?(?<!/)>', re.I | re.S)
    cl = re.compile(r'</' + re.escape(tag) + r'\s*>', re.I)
    depth, i = 1, start
    while depth > 0:
        no, nc = op.search(html, i), cl.search(html, i)
        if nc is None:
            return None
        if no and no.start() < nc.start():
            depth += 1
            i = no.end()
        else:
            depth -= 1
            if depth == 0:
                return html[:start] + inner + html[nc.start():]
            i = nc.end()
    return None


def refresh_fallback():
    """用真实浏览器渲染后的 DOM 覆盖 index.html 的 24 个容器（幂等）。"""
    from playwright.async_api import async_playwright

    async def grab():
        async with async_playwright() as p:
            b = await p.chromium.launch(headless=True, executable_path=CHROMIUM,
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])
            pg = await b.new_page(viewport={"width": 1440, "height": 900})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto("file://" + os.path.join(SRC, "index.html"), wait_until="load", timeout=30000)
            # 清掉浏览器本地数据，保证静态兜底是纯种子态
            await pg.evaluate("() => { try{localStorage.clear()}catch(e){} }")
            await pg.reload(wait_until="load", timeout=30000)
            await pg.wait_for_timeout(2400)  # 等数字滚动、GSAP 结束
            data = await pg.evaluate("""(ids) => {
              const o = {};
              ids.forEach(id => { const e = document.getElementById(id); o[id] = e ? e.innerHTML : null; });
              const f = document.getElementById('scoreFill'), d = document.getElementById('scoreDot');
              o._fill = f ? f.style.width : '';
              o._dot  = d ? d.style.left : '';
              return o;
            }""", IDS)
            await b.close()
            return data, errs

    data, errs = asyncio.run(grab())
    if errs:
        log("导出时页面报错: " + "; ".join(errs[:3]))

    path = os.path.join(SRC, "index.html")
    html = open(path, encoding="utf-8").read()
    done, skipped = [], []
    for id_, inner in data.items():
        if id_.startswith("_") or inner is None:
            continue
        new_html = replace_container(html, id_, inner)
        if new_html is None:
            skipped.append(id_)
            continue
        html = new_html
        done.append(id_)
    html = re.sub(r'id="scoreFill"[^>]*>', 'id="scoreFill" style="width:%s">' % data["_fill"], html, count=1)
    html = re.sub(r'id="scoreDot"[^>]*>', 'id="scoreDot" style="left:%s">' % data["_dot"], html, count=1)
    # 发版前洁净度断言：源 index.html 里只有 calGrid 含 data-day，
    # 数量必须恰好等于本次导出，否则说明容器外还有历史残留格子（会竖排），拒绝上线。
    expect = (data.get("calGrid") or "").count("data-day=")
    actual = html.count("data-day=")
    if expect and actual != expect:
        raise RuntimeError("静态兜底格子残留：导出 %d 格，HTML 内却有 %d 个 data-day，拒绝发版" % (expect, actual))
    open(path, "w", encoding="utf-8").write(html)
    log(f"静态兜底刷新: {len(done)} 容器 / 跳过 {skipped} / 格子 {actual} 个（校验通过）")
    return {"containers": len(done), "skipped": skipped, "cells": actual, "pageerrors": len(errs)}


def bump_versions():
    """按本地资源内容生成版本号，改写 index.html 的 ?v=。
    内容不变则版本不变（缓存有效），任一文件变了则自动破缓存，
    避免 App 内置浏览器长期拿旧 styles.css / app.js 导致格历塌陷。"""
    path = os.path.join(SRC, "index.html")
    html = open(path, encoding="utf-8").read()
    ver = {}
    for f in ["styles.css", "config.js", "traces.js", "app.js"]:
        fp = os.path.join(SRC, f)
        if os.path.exists(fp):
            ver[f] = hashlib.md5(open(fp, "rb").read()).hexdigest()[:10]
    for f, h in ver.items():
        html = re.sub(r'((?:href|src)="' + re.escape(f) + r')\?v=[^"]*(")',
                      lambda m, h=h: m.group(1) + "?v=" + h + m.group(2), html)
    open(path, "w", encoding="utf-8").write(html)
    return ver


def deploy():
    """生成零子资源单文件并上线（覆盖 index.html 即生效，链接不变）。

    不再复制 styles.css / *.js / assets —— 这些外网子资源在 iPad Safari 与
    移动 WebView 上会被 403 拦截。全部内联后页面不发出任何子资源请求。
    """
    ver = bump_versions()          # 源目录仍维护 ?v=，供 file:// 本地预览破缓存
    out, stats = build_single_file()
    log("已生成零子资源单文件 %s (%d B) | 版本号 %s"
        % (out, stats["total_bytes"], json.dumps(ver, ensure_ascii=False)))
    return {"dir": SITE, "single_file": True, "versions": ver, **stats}


def http_ok(url, timeout=8):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


# ---------- GitHub Pages 永久发布（仓库即真相源） ----------

def gh_api(path, method="GET", body=None, tries=4):
    """api.github.com 带 token 请求；网络抖动时重试。"""
    last = None
    for _ in range(tries):
        try:
            data = json.dumps(body).encode() if body is not None else None
            req = urllib.request.Request(
                "https://api.github.com" + path, data=data,
                headers={"Authorization": "Bearer " + GH_TOKEN,
                         "Accept": "application/vnd.github+json",
                         "User-Agent": "gkzd-sync"}, method=method)
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode("utf-8") or "{}")
            except Exception:
                return e.code, {}
        except Exception as e:
            last = e
            time.sleep(3)
    raise RuntimeError("gh_api %s 失败: %s" % (path, str(last)[:120]))


def _git(args, cwd=None):
    """跑 git，返回 (returncode, 脱敏输出)。token 绝不出现在日志里。"""
    r = subprocess.run(["git"] + args, capture_output=True, text=True, timeout=240, cwd=cwd)
    out = ((r.stdout or "") + (r.stderr or "")).replace(GH_TOKEN, "***")
    return r.returncode, out.strip()[-300:]


def gh_prepare():
    """拿到干净的工作副本（clone 或 reset），返回错误信息或 None。
    定时任务场景：SRC 就是 GH_DIR/src（工作克隆自身）。此时严禁在发版中途
    fetch/reset/clean——那会抹掉本会话刚通过 --add 写入的痕迹与兜底刷新，
    然后提交出「无变化」的假成功。同步远程状态是任务流程步骤 0c 的职责。"""
    url = "https://oauth2:" + GH_TOKEN + "@github.com/" + GH_REPO + ".git"
    if os.path.realpath(SRC) == os.path.realpath(os.path.join(GH_DIR, "src")):
        if os.path.isdir(os.path.join(GH_DIR, ".git")):
            _git(["config", "user.name", "gkzd-sync"], cwd=GH_DIR)
            _git(["config", "user.email", "xxoo13149@users.noreply.github.com"], cwd=GH_DIR)
            log("工作克隆模式（SRC=GH_DIR/src）：跳过 fetch/reset，保持本会话产物")
            return None
        shutil.rmtree(GH_DIR, ignore_errors=True)
        out = ""
        for _ in range(4):
            rc, out = _git(["clone", "--depth", "1", "-b", "main", url, GH_DIR])
            if rc == 0:
                _git(["remote", "set-url", "origin", url], cwd=GH_DIR)
                _git(["config", "user.name", "gkzd-sync"], cwd=GH_DIR)
                _git(["config", "user.email", "xxoo13149@users.noreply.github.com"], cwd=GH_DIR)
                return None
            shutil.rmtree(GH_DIR, ignore_errors=True)
            time.sleep(4)
        return "clone 失败: " + out
    if os.path.isdir(os.path.join(GH_DIR, ".git")):
        if _git(["fetch", "origin", "main"], cwd=GH_DIR)[0] == 0:
            _git(["reset", "--hard", "origin/main"], cwd=GH_DIR)
            _git(["clean", "-fdq"], cwd=GH_DIR)
            return None
    shutil.rmtree(GH_DIR, ignore_errors=True)
    out = ""
    for _ in range(4):
        rc, out = _git(["clone", "--depth", "1", "-b", "main", url, GH_DIR])
        if rc == 0:
            _git(["remote", "set-url", "origin", url], cwd=GH_DIR)
            # 克隆仓库没有 git 身份，不配置的话 commit 会静默失败（曾造成"假成功"）：
            _git(["config", "user.name", "gkzd-sync"], cwd=GH_DIR)
            _git(["config", "user.email", "xxoo13149@users.noreply.github.com"], cwd=GH_DIR)
            return None
        shutil.rmtree(GH_DIR, ignore_errors=True)
        time.sleep(4)
    return "clone 失败: " + out


def gh_mirror_files():
    """把部署单文件与工程源码镜像进仓库工作副本。
    定时任务场景下 SRC 就是 GH_DIR/src（工作克隆自身），逐文件判重，绝不自己复制自己。"""
    shutil.copyfile(os.path.join(SITE, "index.html"), os.path.join(GH_DIR, "index.html"))
    s = os.path.join(GH_DIR, "src")
    os.makedirs(os.path.join(s, ".lsf"), exist_ok=True)
    os.makedirs(os.path.join(s, "assets", "vendor"), exist_ok=True)
    for f in ["app.js", "config.js", "traces.js", "styles.css", "index.html",
              "build.py", "sync_ima.py", "bootstrap.py", "DESIGN.md"]:
        src_fp = os.path.join(SRC, f)
        dst_fp = os.path.join(s, f)
        if os.path.exists(src_fp) and os.path.realpath(src_fp) != os.path.realpath(dst_fp):
            shutil.copyfile(src_fp, dst_fp)
    tp = os.path.join(SRC, ".lsf", "task-prompt.txt")
    tp_dst = os.path.join(s, ".lsf", "task-prompt.txt")
    if os.path.exists(tp) and os.path.realpath(tp) != os.path.realpath(tp_dst):
        shutil.copyfile(tp, tp_dst)


def fetch_pages_probe(total, span=4096, tries=8):
    """github.io 传输常被掐断，完整下载不可靠。只抽查首尾各 span 字节（Range）。

    返回 (match, detail)：match=首尾都与本地一致；下载不动则为 (None, "...")。
    """
    local = open(os.path.join(SITE, "index.html"), "rb").read()
    head, tail = local[:span], local[-span:]
    got = {}
    for name, rng in (("head", "bytes=0-%d" % (span - 1)),
                      ("tail", "bytes=%d-%d" % (total - span, total - 1))):
        for _ in range(tries):
            try:
                req = urllib.request.Request(
                    GH_PAGES_URL, headers={"Range": rng, "User-Agent": "gkzd-sync"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    data = r.read()
                if len(data) == span:
                    got[name] = data
                    break
            except Exception:
                time.sleep(2)
        if name not in got:
            return None, "抽查段 %s 下载失败（CDN 传输受限，不代表部署失败）" % name
    return got["head"] == head and got["tail"] == tail, "head+tail 抽查"


def gh_publish(added):
    """推送新单文件与源码到 GitHub，等 Pages 构建，回读校验。

    fail-closed：没 token / 推不上去 / 校验不过，都如实写进报告，绝不假装成功。
    """
    if not GH_TOKEN:
        return {"pushed": False, "reason": "no_token",
                "hint": "GITHUB_TOKEN 未设置（应从 IMA 知识库读取）"}
    err = gh_prepare()
    if err:
        return {"pushed": False, "error": err}
    gh_mirror_files()
    _git(["add", "-A"], cwd=GH_DIR)
    rc, names = _git(["diff", "--cached", "--name-only"], cwd=GH_DIR)
    if not names:
        return {"pushed": True, "changed": False, "reason": "nothing_to_commit",
                "pages_url": GH_PAGES_URL}
    msg = "sync: " + (",".join(added) if added else "rebuild")
    rc, sha_old = _git(["rev-parse", "HEAD"], cwd=GH_DIR)
    rc, out = _git(["commit", "-q", "-m", msg], cwd=GH_DIR)
    if rc != 0:
        return {"pushed": False, "error": "commit 失败: " + out}
    rc, sha_new = _git(["rev-parse", "HEAD"], cwd=GH_DIR)
    if sha_new.strip() == sha_old.strip():
        return {"pushed": False, "error": "commit 未产生新提交（HEAD 未变化），拒绝继续"}
    pushed = False
    for i in range(3):
        rc, out = _git(["push", "origin", "HEAD:main"], cwd=GH_DIR)
        if rc == 0:
            pushed = True
            break
        log("push 第 %d 次失败，重试: %s" % (i + 1, out))
        time.sleep(4)
    if not pushed:
        return {"pushed": False, "error": "push 失败: " + out}
    rc, sha_new = _git(["rev-parse", "HEAD"], cwd=GH_DIR)
    sha_new = sha_new.strip()
    # 校验一：远程 main 的 commit 与本地一致（git 通道可靠，不依赖 CDN）
    remote_match = False
    try:
        code, ref = gh_api("/repos/%s/git/ref/heads/main" % GH_REPO)
        remote_sha = ((ref.get("object") or {}).get("sha") or "").strip()
        remote_match = remote_sha == sha_new
    except Exception as e:
        log("远程校验查询失败: " + str(e)[:80])
    # 校验二：等 Pages 把新 commit 构建完（builds API；构建失败或超时如实记录）
    time.sleep(10)
    build = "timeout"
    for _ in range(15):
        try:
            code, b = gh_api("/repos/%s/pages/builds/latest" % GH_REPO)
            if code == 200 and (b.get("commit") or "").startswith(sha_new[:7]) and b.get("status") == "built":
                build = "built"
                break
        except Exception as e:
            log("build 状态查询失败: " + str(e)[:80])
        time.sleep(12)
    # 校验三：Pages 首尾抽查（CDN 传输受限时尽力而为，不单独判死）
    local = open(os.path.join(SITE, "index.html"), "rb").read()
    probe, probe_detail = fetch_pages_probe(len(local))
    return {"pushed": True, "changed": True, "commit": sha_new[:10],
            "remote_match": remote_match, "build": build,
            "pages_url": GH_PAGES_URL, "pages_probe": probe,
            "pages_probe_detail": probe_detail}


def ensure_service():
    if http_ok(LOCAL_URL):
        return {"running": True, "action": "none"}
    log("3000 服务未响应，重新发布")
    r = subprocess.run(["node", PUBLISH_JS, "--dir", SITE, "--language", "static"],
                       capture_output=True, text=True, timeout=180)
    tail = (r.stdout or "").strip().splitlines()
    out = tail[-1] if tail else ""
    try:
        parsed = json.loads(out)
    except Exception:
        parsed = {"raw": out, "stderr": (r.stderr or "")[-300:]}
    return {"running": http_ok(LOCAL_URL), "action": "republish", "publish": parsed,
            "exit": r.returncode}


def verify_online(share_url=None):
    """真实浏览器：JS 开启验交互，JS 关闭验静态兜底。"""
    from playwright.async_api import async_playwright

    async def run():
        async with async_playwright() as p:
            b = await p.chromium.launch(headless=True, executable_path=CHROMIUM,
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])
            res = {}
            # A. JS 开启
            ctx = await b.new_context(viewport={"width": 1440, "height": 900})
            pg = await ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console." + m.type + " " + m.text) if m.type == "error" else None)
            await pg.goto(LOCAL_URL, wait_until="networkidle", timeout=30000)
            await pg.wait_for_timeout(1600)
            res["js_on"] = await pg.evaluate("""() => ({
              bg: getComputedStyle(document.body).backgroundColor,
              cells: document.querySelectorAll('#calGrid .cell').length,
              done: document.querySelectorAll('#calGrid .cell--done').length,
              traces: document.querySelectorAll('#traceList > li').length,
              tasks: document.querySelectorAll('#taskList .task').length,
              delBtns: document.querySelectorAll('.trace__del').length,
              stats: (document.querySelector('#stats')||{}).innerText.replace(/\\s+/g,' ').trim(),
              icons: document.querySelectorAll('svg.lucide').length,
              overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
            })""")
            # 交互：点一个留痕格 → 开抽屉；Esc 关
            cell = await pg.query_selector("#calGrid .cell--done")
            if cell:
                await cell.click()
                await pg.wait_for_timeout(300)
                res["drawer_opens"] = await pg.evaluate("()=>document.querySelector('#drawer').classList.contains('is-open')")
                await pg.keyboard.press("Escape")
            # 交互：两段式删除 → 取消（不破坏数据）
            delbtn = await pg.query_selector("#traceList > li:first-child .trace__del")
            if delbtn:
                await delbtn.click()
                await pg.wait_for_timeout(200)
                res["delete_confirm"] = await pg.evaluate("()=>document.querySelectorAll('.trace__confirm').length>0")
                cancel = await pg.query_selector("[data-del-cancel]")
                if cancel:
                    await cancel.click()
            res["js_on_errors"] = errs[:5]
            await ctx.close()
            # B. JS 关闭（模拟预览面板）
            ctx2 = await b.new_context(viewport={"width": 1440, "height": 900}, java_script_enabled=False)
            pg2 = await ctx2.new_page()
            await pg2.goto(LOCAL_URL, wait_until="load", timeout=30000)
            await pg2.wait_for_timeout(500)
            res["js_off"] = await pg2.evaluate("""() => ({
              cells: document.querySelectorAll('#calGrid .cell').length,
              done: document.querySelectorAll('#calGrid .cell--done').length,
              traces: document.querySelectorAll('#traceList > li').length,
              delBtns: document.querySelectorAll('.trace__del').length,
              overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
            })""")
            await ctx2.close()
            # C. 模拟 iPad / 移动 WebView：所有非文档请求被 403 拦截
            #    （等价于 cookie 被拒后子资源全挂）。单文件页面此时应零请求且完整。
            ctx3 = await b.new_context(viewport={"width": 1024, "height": 768})
            pg3 = await ctx3.new_page()
            blocked = []

            async def deny(route, blocked=blocked):
                if route.request.resource_type == "document":
                    await route.continue_()
                else:
                    blocked.append(route.request.url.split("/")[-1][:40])
                    await route.abort()

            await pg3.route("**/*", deny)
            e3 = []
            pg3.on("pageerror", lambda e: e3.append(str(e)))
            await pg3.goto(LOCAL_URL, wait_until="load", timeout=30000)
            await pg3.wait_for_timeout(1200)
            res["no_subresource"] = await pg3.evaluate("""() => ({
              bg: getComputedStyle(document.body).backgroundColor,
              grid: getComputedStyle(document.getElementById('calGrid')).display,
              cols: getComputedStyle(document.getElementById('calGrid')).gridTemplateColumns.split(/\\s+/).filter(Boolean).length,
              cells: document.querySelectorAll('#calGrid .cell').length,
              done: document.querySelectorAll('#calGrid .cell--done').length,
              traces: document.querySelectorAll('#traceList > li').length,
              delBtns: document.querySelectorAll('.trace__del').length,
              icons: document.querySelectorAll('svg.lucide').length,
              overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
            })""")
            res["blocked_subresources"] = blocked[:10]
            res["no_subresource_errors"] = e3[:5]
            await ctx3.close()
            # D. 公网链接可达 + 内容一致性（防止「本地已改、线上没更新」的假成功）
            if share_url:
                res["public_ok"] = http_ok(share_url, 15)
                res["public_hash_match"] = False
                for _ in range(3):
                    try:
                        with urllib.request.urlopen(share_url, timeout=15) as r:
                            remote = r.read()
                        local = open(os.path.join(SITE, "index.html"), "rb").read()
                        if hashlib.sha256(remote).hexdigest() == hashlib.sha256(local).hexdigest():
                            res["public_hash_match"] = True
                            res["public_bytes"] = len(remote)
                            break
                    except Exception as e:
                        res["public_hash_error"] = str(e)[:120]
                    await asyncio.sleep(2)
            await b.close()
            return res

    return asyncio.run(run())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--add", help="新增痕迹 JSON 数组文件")
    ap.add_argument("--deploy-only", action="store_true", help="不追加数据，只发版")
    ap.add_argument("--check", action="store_true", help="只读体检")
    ap.add_argument("--share-url", default=os.environ.get("GK_SHARE_URL", ""), help="公网分享链接（可选，用于可达性检查）")
    args = ap.parse_args()

    if args.check:
        dates, _ = read_existing_dates(os.path.join(SRC, "traces.js"))
        try:
            _, st = build_html()
            single = {"build_bytes": st["total_bytes"],
                      "inline_scripts": len(st["inline_scripts"]),
                      "subresource_refs": st["subresource_refs"]}
        except Exception as e:
            single = {"error": str(e)[:160]}
        print(json.dumps({"traces_dates": sorted(dates), "trace_count": len(dates),
                          "files_differ": files_differ(), "local_service": http_ok(LOCAL_URL),
                          "single_file": single},
                         ensure_ascii=False, indent=2))
        return

    added, changed = ([], False) if args.deploy_only else add_traces(args.add)
    diff_before = files_differ()
    need = changed or args.deploy_only or bool(diff_before)
    report = {"added": added, "files_differ_before": diff_before, "deployed": False}

    if not need:
        report["reason"] = "无新增痕迹且源文件未变，不发版"
        print(json.dumps(report, ensure_ascii=False))
        return

    report["fallback"] = refresh_fallback()
    report["deploy"] = deploy()
    if SKIP_PUBLISH:
        # 临时沙箱：绝不重新发布 WorkBuddy 链接（会生成新链接）；3000 服务不存在属正常
        report["service"] = {"running": False, "action": "skipped_by_gk_skip_publish"}
    else:
        report["service"] = ensure_service()
    try:
        report["verify"] = verify_online(args.share_url or None)
    except Exception as e:
        report["verify"] = {"error": str(e)[:300]}
    try:
        report["github"] = gh_publish(added)
    except Exception as e:
        report["github"] = {"pushed": False, "error": str(e)[:300]}
    report["deployed"] = True
    report["files_differ_after"] = files_differ()
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
