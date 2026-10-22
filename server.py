#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""纸间 PDF —— 完全在本机运行的轻量 PDF 工具。

只使用 Python 标准库提供的 HTTP 服务，配合 PyMuPDF (fitz) 与 Pillow。
启动后浏览器访问 127.0.0.1 即可使用，文件不会上传到任何云端。
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import secrets
import shutil
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import Any

try:
    import pymupdf as fitz  # PyMuPDF
    from PIL import Image, ImageOps, UnidentifiedImageError
except ImportError as exc:  # pragma: no cover - 仅用于启动时提示
    print("\n缺少运行依赖：" + str(exc))
    print("请在当前目录执行： python -m pip install -r requirements.txt\n")
    raise SystemExit(1)

APP_NAME = "纸间 PDF"
APP_VERSION = "1.2.0"

# 源码运行时，资源和数据都在项目目录；
# PyInstaller 单文件运行时，static 在临时解包目录，数据放在 EXE 旁边。
FROZEN = bool(getattr(sys, "frozen", False))
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR)) if FROZEN else APP_DIR
BASE_DIR = APP_DIR
STATIC_DIR = RESOURCE_DIR / "static"
DATA_DIR = APP_DIR / ".data"
DOCS_DIR = DATA_DIR / "docs"
EXPORTS_DIR = DATA_DIR / "exports"
TMP_DIR = DATA_DIR / "tmp"

# Windows 的 MIME 注册表有时会把 .js 识别成 text/plain，浏览器会拒绝执行。
STATIC_MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}

MAX_UPLOAD_BYTES = 250 * 1024 * 1024
MAX_PDF_PAGES = 5000
MAX_OUTPUT_PAGES = 5000
MAX_IMAGE_PIXELS = 80_000_000
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_THUMB_WIDTH = 1800
MAX_SPLIT_FILES = 500
MAX_CONVERT_PAGES = 1500

# 运行时内存索引。文件本身保存在 .data 下，不会修改任何原始文件。
DOCS: dict[str, dict[str, Any]] = {}
EXPORTS: dict[str, dict[str, Any]] = {}
DOCS_LOCK = threading.RLock()
DOC_LOCKS: dict[str, threading.Lock] = {}
APP_TOKEN = secrets.token_urlsafe(32)


class UserError(Exception):
    """可以直接展示给用户的中文错误。"""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------

def ensure_dirs() -> None:
    for folder in (DOCS_DIR, EXPORTS_DIR, TMP_DIR):
        folder.mkdir(parents=True, exist_ok=True)


def cleanup_old_files(hours: int = 24) -> None:
    """清理上次运行遗留的临时文件，但保留近期文件。"""
    cutoff = time.time() - hours * 3600
    for base in (DOCS_DIR, EXPORTS_DIR, TMP_DIR):
        if not base.exists():
            continue
        for child in base.iterdir():
            try:
                if child.stat().st_mtime < cutoff:
                    if child.is_dir():
                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        child.unlink(missing_ok=True)
            except OSError:
                pass


def new_id() -> str:
    return secrets.token_hex(10)


def clean_stem(name: str, fallback: str = "纸间文档") -> str:
    """只保留安全的文件名主体，允许中文。"""
    raw = (name or "").strip()
    raw = re.sub(r"\.(pdf|png|jpe?g|webp|bmp|tiff?)$", "", raw, flags=re.I)
    raw = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", raw)
    raw = re.sub(r"\s+", " ", raw).strip().strip(".")
    if not raw:
        raw = fallback
    return raw[:80]


def display_name(name: str) -> str:
    name = os.path.basename((name or "").replace("\\", "/")).strip()
    name = re.sub(r"[\x00-\x1f]", "", name)
    if not name:
        name = "未命名文件"
    return name[:160]


def human_size(num: int) -> str:
    value = float(max(0, num))
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def doc_lock(doc_id: str) -> threading.Lock:
    with DOCS_LOCK:
        lock = DOC_LOCKS.get(doc_id)
        if lock is None:
            lock = threading.Lock()
            DOC_LOCKS[doc_id] = lock
        return lock


def get_doc(doc_id: Any) -> dict[str, Any]:
    if not isinstance(doc_id, str) or not re.fullmatch(r"[0-9a-f]{20}", doc_id):
        raise UserError("文件标识无效，请重新导入文件。")
    with DOCS_LOCK:
        doc = DOCS.get(doc_id)
    if not doc:
        raise UserError("找不到这个文件，可能已被清理，请重新导入。", 404)
    return doc


def page_size_of(page: Any) -> tuple[float, float]:
    # PyMuPDF 的 page.rect 已经反映 /Rotate，不再额外交换宽高。
    rect = page.rect
    return float(rect.width), float(rect.height)


def analyze_pdf(path: Path, name: str, size: int) -> dict[str, Any]:
    try:
        pdf = fitz.open(path)
    except Exception as exc:
        raise UserError("这个 PDF 无法读取，文件可能已损坏或格式不受支持。") from exc

    try:
        if pdf.needs_pass:
            raise UserError("这个 PDF 设置了打开密码，暂时无法处理加密文档。")
        if pdf.page_count <= 0:
            raise UserError("这个 PDF 没有可用页面。")
        if pdf.page_count > MAX_PDF_PAGES:
            raise UserError(f"PDF 页数过多（{pdf.page_count} 页），当前最多支持 {MAX_PDF_PAGES} 页。")
        pages = []
        for index in range(pdf.page_count):
            width, height = page_size_of(pdf[index])
            pages.append({
                "index": index,
                "width": round(width, 1),
                "height": round(height, 1),
            })
        return {
            "id": new_id(),
            "name": name,
            "kind": "pdf",
            "unit": "pt",
            "size": size,
            "size_text": human_size(size),
            "page_count": pdf.page_count,
            "pages": pages,
            "created_at": int(time.time()),
        }
    finally:
        pdf.close()


def image_to_jpeg(source: Path, target: Path) -> tuple[int, int]:
    try:
        with Image.open(source) as opened:
            try:
                opened.seek(0)
            except EOFError:
                pass
            image = ImageOps.exif_transpose(opened)
            image.load()
            width, height = image.size
            if width < 2 or height < 2:
                raise UserError("图片尺寸过小，无法使用。")
            if width * height > MAX_IMAGE_PIXELS:
                raise UserError("图片像素过大，请压缩到 8000 万像素以内后再试。")

            if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, "white")
                background.paste(rgba, mask=rgba.getchannel("A"))
                output = background
            else:
                output = image.convert("RGB")

            output.save(
                target,
                "JPEG",
                quality=92,
                optimize=True,
                progressive=True,
            )
            return output.width, output.height
    except UserError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise UserError("无法读取这张图片，请换用 JPG、PNG、WebP、BMP 或 TIFF 格式。") from exc


def import_temp_file(temp_path: Path, original_name: str) -> dict[str, Any]:
    """把上传到临时目录的文件登记为一个文档。"""
    name = display_name(original_name)
    try:
        with temp_path.open("rb") as handle:
            header = handle.read(8)
    except OSError as exc:
        raise UserError("读取上传文件失败，请重试。") from exc

    doc_id = new_id()
    doc_dir = DOCS_DIR / doc_id
    doc_dir.mkdir(parents=True, exist_ok=False)

    try:
        size = temp_path.stat().st_size
        if size <= 0:
            raise UserError("文件是空的，请重新选择。")

        if header.startswith(b"%PDF-"):
            target = doc_dir / "source.pdf"
            shutil.move(str(temp_path), str(target))
            doc = analyze_pdf(target, name, size)
            doc["id"] = doc_id
            doc["path"] = str(target)
            with DOCS_LOCK:
                DOCS[doc_id] = doc
            return serialize_doc(doc)

        # 图片：统一转成方向正确、白底 JPEG，后续缩略图与 PDF 输出都稳定。
        target = doc_dir / "source.jpg"
        width, height = image_to_jpeg(temp_path, target)
        doc = {
            "id": doc_id,
            "name": name,
            "kind": "image",
            "unit": "px",
            "size": size,
            "size_text": human_size(size),
            "page_count": 1,
            "pages": [{
                "index": 0,
                "width": width,
                "height": height,
            }],
            "created_at": int(time.time()),
            "path": str(target),
        }
        with DOCS_LOCK:
            DOCS[doc_id] = doc
        return serialize_doc(doc)
    except Exception:
        shutil.rmtree(doc_dir, ignore_errors=True)
        raise
    finally:
        temp_path.unlink(missing_ok=True)


def serialize_doc(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "kind": doc["kind"],
        "unit": doc["unit"],
        "size": doc["size"],
        "size_text": doc["size_text"],
        "page_count": doc["page_count"],
        "pages": doc["pages"],
    }


def register_pdf_copy(source: Path, name: str) -> dict[str, Any]:
    """把生成的 PDF 登记为可继续编辑的新文档。"""
    doc_id = new_id()
    doc_dir = DOCS_DIR / doc_id
    doc_dir.mkdir(parents=True, exist_ok=False)
    target = doc_dir / "source.pdf"
    try:
        shutil.copy2(source, target)
        doc = analyze_pdf(target, name, target.stat().st_size)
        doc["id"] = doc_id
        doc["path"] = str(target)
        with DOCS_LOCK:
            DOCS[doc_id] = doc
        return doc
    except Exception:
        shutil.rmtree(doc_dir, ignore_errors=True)
        raise


def register_export(path: Path, filename: str, kind: str = "file") -> dict[str, Any]:
    export_id = new_id()
    with DOCS_LOCK:
        EXPORTS[export_id] = {
            "path": str(path),
            "filename": filename,
            "size": path.stat().st_size,
            "created_at": int(time.time()),
            "kind": kind,
        }
    return {
        "download": f"/api/download?id={export_id}",
        "filename": filename,
        "size": path.stat().st_size,
        "size_text": human_size(path.stat().st_size),
        "export_id": export_id,
    }


def new_export_dir() -> tuple[str, Path]:
    export_id = new_id()
    folder = EXPORTS_DIR / export_id
    folder.mkdir(parents=True, exist_ok=False)
    return export_id, folder


def write_pdf_from_items(items: list[dict[str, Any]], out_path: Path, title: str) -> int:
    """按 [(doc, page)] 的顺序重建 PDF。不会改动源文件。"""
    if not items:
        raise UserError("没有可导出的页面。")
    if len(items) > MAX_OUTPUT_PAGES:
        raise UserError(f"一次最多导出 {MAX_OUTPUT_PAGES} 页。")

    cache: dict[str, Any] = {}
    out = fitz.open()
    try:
        for item in items:
            doc = get_doc(item.get("doc_id"))
            page_index = item.get("page")
            if not isinstance(page_index, int) or isinstance(page_index, bool):
                raise UserError("页面序号无效。")
            if page_index < 0 or page_index >= doc["page_count"]:
                raise UserError("所选页面不存在，请重新打开文件。")
            if doc["kind"] != "pdf":
                raise UserError("当前操作只适用于 PDF 页面。")

            source = cache.get(doc["id"])
            if source is None:
                try:
                    source = fitz.open(doc["path"])
                except Exception as exc:
                    raise UserError(f"无法读取「{doc['name']}」，文件可能已损坏。") from exc
                if source.needs_pass:
                    raise UserError(f"「{doc['name']}」设置了打开密码，无法处理。")
                cache[doc["id"]] = source
            out.insert_pdf(source, from_page=page_index, to_page=page_index)

        if out.page_count <= 0:
            raise UserError("没有生成任何页面。")
        out.set_metadata({
            "title": title,
            "producer": f"{APP_NAME} {APP_VERSION}",
            "creator": APP_NAME,
            "subject": "由纸间 PDF 导出的页面",
        })
        out.save(str(out_path), garbage=4, deflate=True, clean=True)
        return out.page_count
    finally:
        out.close()
        for source in cache.values():
            try:
                source.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# 缩略图
# ---------------------------------------------------------------------------

def generate_thumbnail(doc: dict[str, Any], page_index: int, width: int) -> Path:
    thumb_dir = Path(doc["path"]).parent / "thumbs"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    target = thumb_dir / f"p{page_index}-w{width}.jpg"
    if target.exists() and target.stat().st_size > 0:
        return target

    tmp_target = target.with_name(f"{target.name}.{secrets.token_hex(3)}.tmp")
    try:
        if doc["kind"] == "pdf":
            with doc_lock(doc["id"]):
                pdf = fitz.open(doc["path"])
                try:
                    if pdf.needs_pass:
                        raise UserError("这个 PDF 设置了打开密码。")
                    if page_index < 0 or page_index >= pdf.page_count:
                        raise UserError("页面不存在。", 404)
                    page = pdf[page_index]
                    page_width, _ = page_size_of(page)
                    zoom = width / max(page_width, 1)
                    zoom = max(0.08, min(zoom, 6.0))
                    pix = page.get_pixmap(
                        matrix=fitz.Matrix(zoom, zoom),
                        alpha=False,
                        colorspace=fitz.csRGB,
                        annots=True,
                    )
                    data = pix.tobytes("jpeg", jpg_quality=86)
                finally:
                    pdf.close()
            tmp_target.write_bytes(data)
        else:
            with doc_lock(doc["id"]):
                with Image.open(doc["path"]) as image:
                    image = image.convert("RGB")
                    max_height = max(width * 3, 480)
                    image.thumbnail((width, max_height), Image.Resampling.LANCZOS)
                    buffer = BytesIO()
                    image.save(buffer, "JPEG", quality=88, optimize=True, progressive=True)
                    tmp_target.write_bytes(buffer.getvalue())
        os.replace(tmp_target, target)
        return target
    finally:
        tmp_target.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# 操作
# ---------------------------------------------------------------------------

def export_pages(payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise UserError("请至少保留一页再导出。")
    name = clean_stem(str(payload.get("name") or "整理结果"), "整理结果")
    _, folder = new_export_dir()
    filename = f"{name}.pdf"
    out_path = folder / filename
    page_count = write_pdf_from_items(items, out_path, name)
    result = register_export(out_path, filename, "pdf")
    result["page_count"] = page_count
    return result


def merge_documents(payload: dict[str, Any]) -> dict[str, Any]:
    doc_ids = payload.get("doc_ids")
    if not isinstance(doc_ids, list) or not doc_ids:
        raise UserError("请至少添加一个 PDF 文件。")
    if len(doc_ids) > 100:
        raise UserError("一次最多合并 100 个文件。")
    name = clean_stem(str(payload.get("name") or "合并文档"), "合并文档")
    items: list[dict[str, Any]] = []
    names: list[str] = []
    for doc_id in doc_ids:
        doc = get_doc(doc_id)
        if doc["kind"] != "pdf":
            raise UserError("合并功能只支持 PDF 文件。")
        names.append(doc["name"])
        for page_index in range(doc["page_count"]):
            items.append({"doc_id": doc["id"], "page": page_index})
    if not items:
        raise UserError("这些文件没有可合并的页面。")
    if len(items) > MAX_OUTPUT_PAGES:
        raise UserError(f"合并后的页数过多，当前最多支持 {MAX_OUTPUT_PAGES} 页。")

    _, folder = new_export_dir()
    filename = f"{name}.pdf"
    out_path = folder / filename
    page_count = write_pdf_from_items(items, out_path, name)
    export = register_export(out_path, filename, "pdf")
    new_doc = register_pdf_copy(out_path, filename)
    export["page_count"] = page_count
    export["doc"] = serialize_doc(new_doc)
    return export


def compose_documents(payload: dict[str, Any]) -> dict[str, Any]:
    """取来源 PDF 的页面，替换目标页范围或插入目标位置。"""
    target = get_doc(payload.get("target_id"))
    source = get_doc(payload.get("source_id"))
    if target["kind"] != "pdf" or source["kind"] != "pdf":
        raise UserError("替换与插入功能只支持 PDF 文件。")

    page_list = payload.get("source_pages")
    if not isinstance(page_list, list) or not page_list:
        raise UserError("请至少选择一页来源页面。")
    if len(page_list) > MAX_OUTPUT_PAGES:
        raise UserError("选择的来源页面过多。")

    seen: set[int] = set()
    source_pages: list[int] = []
    for value in page_list:
        if not isinstance(value, int) or isinstance(value, bool):
            raise UserError("来源页面序号无效。")
        if value < 0 or value >= source["page_count"]:
            raise UserError("来源页面超出了文档范围，请重新选择。")
        if value not in seen:
            seen.add(value)
            source_pages.append(value)
    if not source_pages:
        raise UserError("请至少选择一页来源页面。")
    source_pages.sort()

    target_count = target["page_count"]
    items: list[dict[str, Any]] = []
    mode = str(payload.get("mode") or "replace").lower()
    if mode == "replace":
        start = payload.get("target_start")
        end = payload.get("target_end")
        if (
            not isinstance(start, int) or isinstance(start, bool)
            or not isinstance(end, int) or isinstance(end, bool)
        ):
            raise UserError("请填写有效的目标页码。")
        if start < 0 or end < 0 or end >= target_count or start > end:
            raise UserError(f"目标页码范围需要在 1 到 {target_count} 之间，且起始页不能大于结束页。")
        for page_index in range(0, start):
            items.append({"doc_id": target["id"], "page": page_index})
        for page_index in source_pages:
            items.append({"doc_id": source["id"], "page": page_index})
        for page_index in range(end + 1, target_count):
            items.append({"doc_id": target["id"], "page": page_index})
    elif mode == "insert":
        insert_index = payload.get("insert_index")
        if not isinstance(insert_index, int) or isinstance(insert_index, bool):
            raise UserError("请选择有效的插入位置。")
        if insert_index < 0 or insert_index > target_count:
            raise UserError(f"插入位置需要在 0 到 {target_count} 页之间。")
        for page_index in range(0, insert_index):
            items.append({"doc_id": target["id"], "page": page_index})
        for page_index in source_pages:
            items.append({"doc_id": source["id"], "page": page_index})
        for page_index in range(insert_index, target_count):
            items.append({"doc_id": target["id"], "page": page_index})
    else:
        raise UserError("未知的页面合成方式。")

    if not items:
        raise UserError("合成后没有可用页面。")
    if len(items) > MAX_OUTPUT_PAGES:
        raise UserError(f"合成后的页数过多，当前最多支持 {MAX_OUTPUT_PAGES} 页。")

    fallback_name = f"{Path(target['name']).stem}-{'替换' if mode == 'replace' else '插入'}"
    name = clean_stem(str(payload.get("name") or fallback_name), fallback_name)
    _, folder = new_export_dir()
    filename = f"{name}.pdf"
    out_path = folder / filename
    page_count = write_pdf_from_items(items, out_path, name)
    export = register_export(out_path, filename, "pdf")
    new_doc = register_pdf_copy(out_path, filename)
    export["page_count"] = page_count
    export["doc"] = serialize_doc(new_doc)
    return export


def parse_ranges(text: Any, page_count: int) -> list[tuple[int, int]]:
    if not isinstance(text, str) or not text.strip():
        raise UserError("请输入页码范围，例如 1-3, 5, 8-10。")
    pieces = [p for p in re.split(r"[,，;；\n]+", text.strip()) if p.strip()]
    if not pieces:
        raise UserError("请输入有效的页码范围。")
    if len(pieces) > MAX_SPLIT_FILES:
        raise UserError(f"一次最多拆分为 {MAX_SPLIT_FILES} 个文件。")
    ranges: list[tuple[int, int]] = []
    for piece in pieces:
        match = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+))?\s*", piece)
        if not match:
            raise UserError(f"「{piece.strip()}」不是有效的页码，请使用 1-3 这样的格式。")
        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start < 1 or end < 1:
            raise UserError("页码从 1 开始，请输入大于 0 的数字。")
        if start > end:
            raise UserError(f"「{piece.strip()}」的起始页不能大于结束页。")
        if end > page_count:
            raise UserError(f"「{piece.strip()}」超出了文档范围（共 {page_count} 页）。")
        ranges.append((start - 1, end - 1))
    return ranges


def parse_page_selection(text: Any, page_count: int) -> list[int]:
    if text is None or not str(text).strip() or str(text).strip().lower() in ("all", "全部"):
        return list(range(page_count))
    ranges = parse_ranges(str(text), page_count)
    result: list[int] = []
    seen: set[int] = set()
    for start, end in ranges:
        for page in range(start, end + 1):
            if page not in seen:
                seen.add(page)
                result.append(page)
    if not result:
        raise UserError("没有选中任何页面。")
    return result


def make_pdf_from_range(pdf: Any, start: int, end: int, out_path: Path, title: str) -> None:
    part = fitz.open()
    try:
        part.insert_pdf(pdf, from_page=start, to_page=end)
        part.set_metadata({
            "title": title,
            "producer": f"{APP_NAME} {APP_VERSION}",
            "creator": APP_NAME,
        })
        part.save(str(out_path), garbage=4, deflate=True, clean=True)
    finally:
        part.close()


def split_document(payload: dict[str, Any]) -> dict[str, Any]:
    doc = get_doc(payload.get("doc_id"))
    if doc["kind"] != "pdf":
        raise UserError("拆分功能只支持 PDF 文件。")
    mode = payload.get("mode") or "ranges"
    page_count = doc["page_count"]
    name = clean_stem(str(payload.get("name") or doc["name"]), "拆分结果")
    base_name = clean_stem(Path(doc["name"]).stem, "文档")

    if mode == "ranges":
        ranges = parse_ranges(payload.get("ranges"), page_count)
    elif mode == "every":
        every = payload.get("every")
        if not isinstance(every, int) or isinstance(every, bool) or every < 1:
            raise UserError("请输入每份包含的页数（大于 0 的整数）。")
        if every > page_count:
            raise UserError(f"每份页数不能超过文档总页数（{page_count} 页）。")
        ranges = []
        for start in range(0, page_count, every):
            ranges.append((start, min(start + every - 1, page_count - 1)))
    elif mode == "single":
        ranges = [(index, index) for index in range(page_count)]
    else:
        raise UserError("未知的拆分方式。")

    if len(ranges) > MAX_SPLIT_FILES:
        raise UserError(f"一次最多生成 {MAX_SPLIT_FILES} 个文件。")

    export_id, folder = new_export_dir()
    files_dir = folder / "files"
    files_dir.mkdir()
    part_files: list[Path] = []
    try:
        source = fitz.open(doc["path"])
        if source.needs_pass:
            raise UserError("这个 PDF 设置了打开密码。")
        number_width = max(2, len(str(len(ranges))))
        try:
            for position, (start, end) in enumerate(ranges, start=1):
                if start == end:
                    label = f"第{start + 1}页"
                else:
                    label = f"第{start + 1}-{end + 1}页"
                prefix = str(position).zfill(number_width)
                part_name = f"{prefix}_{base_name}_{label}.pdf"
                part_path = files_dir / part_name
                make_pdf_from_range(source, start, end, part_path, f"{base_name} {label}")
                part_files.append(part_path)
        finally:
            source.close()

        zip_name = f"{name}.zip"
        zip_path = folder / zip_name
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for part_file in part_files:
                archive.write(part_file, arcname=part_file.name)

        shutil.rmtree(files_dir, ignore_errors=True)
        result = register_export(zip_path, zip_name, "zip")
        result["count"] = len(ranges)
        result["page_count"] = page_count
        return result
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise


def pdf_to_images(payload: dict[str, Any]) -> dict[str, Any]:
    doc = get_doc(payload.get("doc_id"))
    if doc["kind"] != "pdf":
        raise UserError("这个文件不是 PDF。")
    image_format = str(payload.get("format") or "png").lower()
    if image_format not in ("png", "jpg", "jpeg"):
        raise UserError("图片格式只支持 PNG 或 JPG。")
    image_format = "jpg" if image_format == "jpeg" else image_format
    try:
        dpi = int(payload.get("dpi") or 150)
    except (TypeError, ValueError):
        raise UserError("分辨率无效。")
    if dpi < 72 or dpi > 300:
        raise UserError("分辨率需要在 72 到 300 DPI 之间。")

    pages = parse_page_selection(payload.get("range"), doc["page_count"])
    if len(pages) > MAX_CONVERT_PAGES:
        raise UserError(f"一次最多转换 {MAX_CONVERT_PAGES} 页。")
    name = clean_stem(str(payload.get("name") or doc["name"]), "图片导出")
    base_name = clean_stem(Path(doc["name"]).stem, "页面")

    export_id, folder = new_export_dir()
    files_dir = folder / "files"
    files_dir.mkdir()
    digit = max(3, len(str(doc["page_count"])))
    zoom = dpi / 72.0
    try:
        pdf = fitz.open(doc["path"])
        if pdf.needs_pass:
            raise UserError("这个 PDF 设置了打开密码。")
        try:
            for page_index in pages:
                page = pdf[page_index]
                pix = page.get_pixmap(
                    matrix=fitz.Matrix(zoom, zoom),
                    alpha=False,
                    colorspace=fitz.csRGB,
                    annots=True,
                )
                if pix.width * pix.height > MAX_IMAGE_PIXELS:
                    raise UserError(f"第 {page_index + 1} 页在 {dpi} DPI 下尺寸过大，请降低分辨率。")
                number = str(page_index + 1).zfill(digit)
                if image_format == "png":
                    data = pix.tobytes("png")
                    extension = "png"
                else:
                    data = pix.tobytes("jpeg", jpg_quality=90)
                    extension = "jpg"
                (files_dir / f"{base_name}_第{number}页.{extension}").write_bytes(data)
        finally:
            pdf.close()

        zip_name = f"{name}.zip"
        zip_path = folder / zip_name
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for image_file in sorted(files_dir.iterdir(), key=lambda p: p.name):
                archive.write(image_file, arcname=image_file.name)
        shutil.rmtree(files_dir, ignore_errors=True)
        result = register_export(zip_path, zip_name, "zip")
        result["count"] = len(pages)
        result["dpi"] = dpi
        result["format"] = image_format.upper()
        return result
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise


def image_to_pdf(payload: dict[str, Any]) -> dict[str, Any]:
    image_ids = payload.get("image_ids")
    if not isinstance(image_ids, list) or not image_ids:
        raise UserError("请至少添加一张图片。")
    if len(image_ids) > 500:
        raise UserError("一次最多放入 500 张图片。")

    page_size = str(payload.get("page_size") or "a4").lower()
    if page_size not in ("a4", "letter", "auto"):
        raise UserError("不支持的页面尺寸。")
    orientation = str(payload.get("orientation") or "auto").lower()
    if orientation not in ("auto", "portrait", "landscape"):
        raise UserError("不支持的页面方向。")
    try:
        margin = float(payload.get("margin") or 0)
    except (TypeError, ValueError):
        raise UserError("页边距无效。")
    if margin < 0 or margin > 72:
        raise UserError("页边距需要在 0 到 72 磅之间。")

    docs = [get_doc(image_id) for image_id in image_ids]
    if any(doc["kind"] != "image" for doc in docs):
        raise UserError("图片转 PDF 只能放入图片文件。")
    name = clean_stem(str(payload.get("name") or "图片合集"), "图片合集")

    _, folder = new_export_dir()
    filename = f"{name}.pdf"
    out_path = folder / filename
    sizes = {"a4": (595.276, 841.89), "letter": (612.0, 792.0)}

    out = fitz.open()
    try:
        for doc in docs:
            width, height = doc["pages"][0]["width"], doc["pages"][0]["height"]
            if not width or not height:
                continue
            landscape = width > height

            if page_size == "auto":
                long_side = 841.89
                scale = long_side / max(width, height)
                page_width, page_height = width * scale, height * scale
                # 原图比例页面不额外旋转，图片本来朝哪边就保留哪边。
            else:
                base_width, base_height = sizes[page_size]
                if orientation == "landscape":
                    page_width, page_height = base_height, base_width
                elif orientation == "portrait":
                    page_width, page_height = base_width, base_height
                else:
                    if landscape:
                        page_width, page_height = base_height, base_width
                    else:
                        page_width, page_height = base_width, base_height

            page_width = max(page_width, 72)
            page_height = max(page_height, 72)
            page = out.new_page(width=page_width, height=page_height)
            available_width = max(page_width - margin * 2, 12)
            available_height = max(page_height - margin * 2, 12)
            scale = min(available_width / width, available_height / height)
            draw_width = width * scale
            draw_height = height * scale
            x0 = (page_width - draw_width) / 2
            y0 = (page_height - draw_height) / 2
            rect = fitz.Rect(x0, y0, x0 + draw_width, y0 + draw_height)
            page.insert_image(rect, filename=doc["path"], keep_proportion=True)

        if out.page_count <= 0:
            raise UserError("没有生成任何页面。")
        out.set_metadata({
            "title": name,
            "producer": f"{APP_NAME} {APP_VERSION}",
            "creator": APP_NAME,
        })
        out.save(str(out_path), garbage=4, deflate=True, clean=True)
        result = register_export(out_path, filename, "pdf")
        result["page_count"] = out.page_count
        return result
    finally:
        out.close()


# ---------------------------------------------------------------------------
# HTTP 服务
# ---------------------------------------------------------------------------

class ThreadingServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows 上 SO_REUSEADDR 会允许两个进程同时监听同一端口，
    # 导致“端口被占用时自动顺延”失效，所以 Windows 必须关掉它。
    allow_reuse_address = os.name != "nt"

    def handle_error(self, request: Any, client_address: Any) -> None:
        """浏览器关闭页面时的正常断连不应该打印整段异常。"""
        error = sys.exc_info()[1]
        if isinstance(error, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    server_version = "PaperlyPDF"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ---- 响应工具 ---------------------------------------------------------
    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; "
            "connect-src 'self'; font-src 'self' data:; object-src 'none'; "
            "base-uri 'none'; form-action 'self'",
        )
        super().end_headers()

    def _send_bytes(
        self,
        status: int,
        data: bytes,
        content_type: str,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        if getattr(self, "command", "") != "HEAD":
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _send_json(self, status: int, data: Any) -> None:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._send_bytes(status, payload, "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def _send_api_error(self, message: str, status: int = 400) -> None:
        self._send_json(status, {"error": message})

    def _read_json(self) -> dict[str, Any]:
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            raise UserError("请求格式不正确。")
        try:
            length = int(length_header)
        except ValueError:
            raise UserError("请求长度无效。")
        if length < 0 or length > MAX_JSON_BYTES:
            raise UserError("请求内容过大。")
        body = self.rfile.read(length)
        try:
            data = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise UserError("请求内容不是有效的 JSON。")
        if not isinstance(data, dict):
            raise UserError("请求格式不正确。")
        return data

    def _save_body_to_temp(self) -> Path:
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            raise UserError("没有收到文件内容。")
        try:
            length = int(length_header)
        except ValueError:
            raise UserError("上传文件长度无效。")
        if length <= 0:
            raise UserError("文件是空的。")
        if length > MAX_UPLOAD_BYTES:
            raise UserError(
                f"单个文件不能超过 {human_size(MAX_UPLOAD_BYTES)}，"
                "请先压缩或拆分后再试。",
                413,
            )
        temp_path = TMP_DIR / f"upload-{secrets.token_hex(8)}.bin"
        remaining = length
        try:
            with temp_path.open("wb") as handle:
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise UserError("上传中途中断，请重试。")
                    handle.write(chunk)
                    remaining -= len(chunk)
            return temp_path
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    def _check_token(self, allow_query: bool = False) -> None:
        token = self.headers.get("X-Paperly-Token", "")
        if allow_query:
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            token = token or (query.get("token") or [""])[0]
        if not token or not secrets.compare_digest(token, APP_TOKEN):
            raise UserError("访问令牌无效，请刷新页面后重试。", 403)

    def _check_origin(self) -> None:
        origin = self.headers.get("Origin")
        if not origin:
            return
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme not in ("http", "https") or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise UserError("不允许的请求来源。", 403)

    def _check_host(self) -> None:
        host = self.headers.get("Host", "")
        hostname = urllib.parse.urlsplit(f"http://{host}").hostname
        if hostname not in ("127.0.0.1", "localhost", "::1"):
            raise UserError("请通过本机地址访问这个工具。", 403)

    def log_message(self, fmt: str, *args: Any) -> None:
        if os.environ.get("PAPERLY_QUIET") == "1":
            return
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {self.address_string()} {fmt % args}\n")

    # ---- 路由 -------------------------------------------------------------
    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        try:
            self._check_host()
            if path.startswith("/api/"):
                self._check_origin()
                self._handle_api_get(path, parsed)
            else:
                self._serve_static(path)
        except UserError as exc:
            self._send_api_error(exc.message, exc.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self._send_api_error("服务出了点问题，请重试一次。", 500)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        try:
            self._check_host()
            self._check_origin()
            self._check_token()
            if path == "/api/import":
                query = urllib.parse.parse_qs(parsed.query)
                name = (query.get("name") or ["未命名文件"])[0]
                temp_path = self._save_body_to_temp()
                doc = import_temp_file(temp_path, name)
                self._send_json(200, {"doc": doc})
                return
            payload = self._read_json()
            if path == "/api/export-pages":
                self._send_json(200, export_pages(payload))
            elif path == "/api/merge":
                self._send_json(200, merge_documents(payload))
            elif path == "/api/compose":
                self._send_json(200, compose_documents(payload))
            elif path == "/api/split":
                self._send_json(200, split_document(payload))
            elif path == "/api/pdf-to-images":
                self._send_json(200, pdf_to_images(payload))
            elif path == "/api/images-to-pdf":
                self._send_json(200, image_to_pdf(payload))
            else:
                self._send_api_error("找不到这个操作。", 404)
        except UserError as exc:
            self._send_api_error(exc.message, exc.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self._send_api_error("处理失败，请检查文件是否损坏后再试。", 500)

    def _handle_api_get(self, path: str, parsed: urllib.parse.ParseResult) -> None:
        if path == "/api/thumb":
            self._check_token(allow_query=True)
            query = urllib.parse.parse_qs(parsed.query)
            doc_id = (query.get("id") or [""])[0]
            page_text = (query.get("page") or ["0"])[0]
            width_text = (query.get("w") or ["360"])[0]
            try:
                page_index = int(page_text)
                width = int(width_text)
            except ValueError:
                raise UserError("缩略图参数无效。")
            if width < 80:
                width = 80
            if width > MAX_THUMB_WIDTH:
                width = MAX_THUMB_WIDTH
            doc = get_doc(doc_id)
            if page_index < 0 or page_index >= doc["page_count"]:
                raise UserError("页面不存在。", 404)
            thumb = generate_thumbnail(doc, page_index, width)
            data = thumb.read_bytes()
            self._send_bytes(
                200,
                data,
                "image/jpeg",
                {"Cache-Control": "private, max-age=3600"},
            )
            return

        if path == "/api/download":
            self._check_token(allow_query=True)
            query = urllib.parse.parse_qs(parsed.query)
            export_id = (query.get("id") or [""])[0]
            if not re.fullmatch(r"[0-9a-f]{20}", export_id):
                raise UserError("下载标识无效。", 404)
            with DOCS_LOCK:
                item = EXPORTS.get(export_id)
            if not item:
                raise UserError("下载文件已失效，请重新生成。", 404)
            file_path = Path(item["path"])
            if not file_path.is_file():
                raise UserError("下载文件已被清理，请重新生成。", 404)
            filename = item["filename"]
            quoted = urllib.parse.quote(filename, safe="")
            extension = file_path.suffix.lower()
            fallback = "document" + extension
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            size = file_path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Content-Disposition",
                f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quoted}",
            )
            self.end_headers()
            if getattr(self, "command", "") == "HEAD":
                return
            try:
                with file_path.open("rb") as handle:
                    while True:
                        chunk = handle.read(1024 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        if path == "/api/health":
            self._send_json(200, {"ok": True, "name": APP_NAME, "version": APP_VERSION})
            return

        raise UserError("找不到这个接口。", 404)

    def _serve_static(self, path: str) -> None:
        if path in ("", "/"):
            relative = "index.html"
        else:
            relative = urllib.parse.unquote(path.lstrip("/"))
        if "\x00" in relative or relative.startswith("."):
            raise UserError("页面不存在。", 404)
        candidate = (STATIC_DIR / relative).resolve()
        try:
            candidate.relative_to(STATIC_DIR.resolve())
        except ValueError:
            raise UserError("页面不存在。", 404)
        if not candidate.is_file():
            raise UserError("页面不存在。", 404)

        mime = STATIC_MIME.get(candidate.suffix.lower())
        if not mime:
            mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix.lower() in (".html", ".js", ".css") and "charset" not in mime:
            mime += "; charset=utf-8"
        data = candidate.read_bytes()
        if candidate.suffix.lower() == ".html":
            data = data.replace(b"__PAPERLY_TOKEN__", APP_TOKEN.encode("ascii"))
            data = data.replace(b"__PAPERLY_VERSION__", APP_VERSION.encode("ascii"))
        self._send_bytes(200, data, mime, {"Cache-Control": "no-cache"})


# ---------------------------------------------------------------------------
# 启动
# ---------------------------------------------------------------------------

def find_bind(preferred: int) -> tuple[ThreadingServer, int]:
    if preferred == 0:
        server = ThreadingServer(("127.0.0.1", 0), Handler)
        return server, server.server_address[1]
    candidates = [preferred] + [p for p in range(preferred + 1, preferred + 20) if p <= 65535]
    last_error: OSError | None = None
    for port in candidates:
        try:
            server = ThreadingServer(("127.0.0.1", port), Handler)
            return server, port
        except OSError as exc:
            last_error = exc
    raise SystemExit(f"无法启动本地服务：{last_error}")


def main() -> None:
    parser = argparse.ArgumentParser(description="纸间 PDF 本地服务")
    parser.add_argument("--port", type=int, default=8765, help="端口号，默认 8765")
    parser.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ensure_dirs()
    cleanup_old_files()

    server, port = find_bind(args.port)
    url = f"http://127.0.0.1:{port}/"
    print()
    print(f"  {APP_NAME}  {APP_VERSION}")
    print("  ─────────────────────────────")
    print(f"  已启动： {url}")
    print("  所有文件都在本机处理，不会上传到云端。")
    print("  关闭这个窗口或按 Ctrl+C 即可停止。")
    print()

    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在关闭纸间 PDF……")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
