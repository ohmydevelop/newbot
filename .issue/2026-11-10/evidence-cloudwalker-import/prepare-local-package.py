"""Prepare an explicitly machine-bound Codex 0.165 compatibility artifact.

Usage: python3 prepare-local-package.py SOURCE.zip INSTALLED_PLUGIN_ROOT OUTPUT.zip
Does not install anything or edit SOURCE.zip. Uses only Python's standard library.
"""
import copy
import hashlib
import json
from pathlib import Path
import sys
import zipfile

source, plugin_root, output = map(Path, sys.argv[1:])
assert source.resolve() != output.resolve()
assert plugin_root.is_absolute()
source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
assert source_sha == "cc3727aab6bd3c51ff2ea7de1ca69977bbf2b72b72bc3d9fd843eeeea5fdeaa4"
renames = {
    "plugin.json": "compatibility/upstream-manifest.json",
    "mcp.json": "compatibility/upstream-mcp-manifest.json",
}
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(source) as original, zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
    manifest = json.loads(original.read("plugin.json"))
    assert manifest["name"] == "cloudwalker" and manifest["version"] == "0.5.0"
    for info in original.infolist():
        updated = copy.copy(info)
        updated.filename = renames.get(info.filename, info.filename)
        target.writestr(updated, original.read(info.filename))
    def add(name, value):
        info = zipfile.ZipInfo(name, date_time=(2026, 11, 10, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        target.writestr(info, value.encode())
    add(".codex-plugin/plugin.json", json.dumps({
        "name": manifest["name"], "version": manifest["version"],
        "description": manifest["description"],
        "skills": "./skills/", "mcpServers": "./.mcp.json",
        "requires_local_executor": True,
        "interface": {"displayName": "CloudWalker", "shortDescription": "牧云安全态势与告警调查"},
    }, ensure_ascii=False, indent=2) + "\n")
    add(".mcp.json", json.dumps({"mcpServers": {"cloudwalker": {
        "type": "stdio", "command": str(plugin_root / "bin/linux-amd64/cloudwalker-mcp"),
        "args": [], "cwd": str(plugin_root),
    }}}, ensure_ascii=False, indent=2) + "\n")
    add("compatibility/README.md", f"""# 本机 newbot 导入兼容包

原包：{source.name}，SHA-256 `{source_sha}`。
固定 Codex 0.165.0；插件仍为 CloudWalker 0.5.0。

仅调整清单与启动路径，原始两个清单在本目录保留，业务二进制、技能和资源内容不变。
MCP 启动路径绑定到 `{plugin_root}`，该路径由本机 newbot 的原生插件安装创建。
此包仅用于该实例，迁移目录或机器后必须重新生成，不能当作通用发行包。
未包含平台地址或 API Token；导入并不表示已取得牧云平台授权。
""")
with zipfile.ZipFile(output) as target, zipfile.ZipFile(source) as original:
    for info in original.infolist():
        name = renames.get(info.filename, info.filename)
        assert target.read(name) == original.read(info.filename), name
        assert target.getinfo(name).external_attr == info.external_attr, name
print(json.dumps({"sourceSha256": source_sha, "output": str(output),
    "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    "pluginRoot": str(plugin_root), "sourceFilesPreserved": True}, ensure_ascii=False))
