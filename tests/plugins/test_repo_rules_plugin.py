"""Tests for the bundled repo-rules plugin.

Covers:
- repo-local rules file resolution under ``<repo>/.hermes/repo-rules.json``
- slash-command add/list/remove flow
- pre_llm_call bounded context injection
- bundled-plugin discovery / opt-in loading behavior
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _isolate_hermes_home(tmp_path, monkeypatch):
    hermes_home = tmp_path / ".hermes-home"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    yield hermes_home


@pytest.fixture
def _repo_cwd(tmp_path, monkeypatch):
    repo = tmp_path / "demo-repo"
    repo.mkdir()
    (repo / ".git").mkdir()
    monkeypatch.chdir(repo)
    monkeypatch.setenv("TERMINAL_CWD", str(repo))
    return repo


@pytest.fixture
def _worktree_like_repo(tmp_path, monkeypatch):
    repo = tmp_path / "worktree-repo"
    repo.mkdir()
    (repo / ".git").write_text("gitdir: /tmp/fake-worktree-gitdir\n", encoding="utf-8")
    nested = repo / "nested" / "deeper"
    nested.mkdir(parents=True)
    monkeypatch.chdir(nested)
    monkeypatch.setenv("TERMINAL_CWD", str(nested))
    return repo, nested


def _load_lib():
    repo_root = Path(__file__).resolve().parents[2]
    lib_path = repo_root / "plugins" / "repo-rules" / "repo_rules.py"
    spec = importlib.util.spec_from_file_location("repo_rules_under_test", lib_path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_plugin_init():
    repo_root = Path(__file__).resolve().parents[2]
    plugin_dir = repo_root / "plugins" / "repo-rules"
    spec = importlib.util.spec_from_file_location(
        "hermes_plugins.repo_rules",
        plugin_dir / "__init__.py",
        submodule_search_locations=[str(plugin_dir)],
    )
    assert spec is not None and spec.loader is not None
    import types

    if "hermes_plugins" not in sys.modules:
        ns = types.ModuleType("hermes_plugins")
        ns.__path__ = []
        sys.modules["hermes_plugins"] = ns
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "hermes_plugins.repo_rules"
    mod.__path__ = [str(plugin_dir)]
    sys.modules["hermes_plugins.repo_rules"] = mod
    spec.loader.exec_module(mod)
    return mod


class TestRepoRulesLibrary:
    def test_resolve_rules_file_under_repo_hermes_dir(self, _repo_cwd):
        rr = _load_lib()
        path = rr.resolve_rules_file()
        assert path == _repo_cwd / ".hermes" / "repo-rules.json"

    def test_resolve_rules_file_accepts_git_file_worktree_marker(self, _worktree_like_repo):
        rr = _load_lib()
        repo, _nested = _worktree_like_repo
        path = rr.resolve_rules_file()
        assert path == repo / ".hermes" / "repo-rules.json"


class TestSlashCommand:
    def test_add_list_remove_cycle(self, _repo_cwd):
        pi = _load_plugin_init()

        out = pi._handle_slash('add "Use pnpm, not npm"')
        assert "Added repo rule" in out

        listed = pi._handle_slash("list")
        assert "1. Use pnpm, not npm" in listed
        assert str(_repo_cwd / ".hermes" / "repo-rules.json") in listed

        removed = pi._handle_slash("remove 1")
        assert "Removed repo rule" in removed
        assert "Use pnpm, not npm" in removed

        empty = pi._handle_slash("list")
        assert "No repo rules saved" in empty

    def test_unknown_subcommand(self, _repo_cwd):
        pi = _load_plugin_init()
        out = pi._handle_slash("bogus")
        assert "Unknown subcommand" in out

    def test_reports_parse_error_for_unmatched_quote(self, _repo_cwd):
        pi = _load_plugin_init()
        out = pi._handle_slash('add "unterminated')
        assert "Could not parse arguments" in out


class TestPreLlmHook:
    def test_injects_saved_repo_rules(self, _repo_cwd):
        pi = _load_plugin_init()
        pi._handle_slash('add "Use pnpm, not npm"')
        pi._handle_slash('add "Do not edit generated files under dist/"')

        injected = pi._on_pre_llm_call(user_message="install a dependency")
        assert isinstance(injected, dict)
        ctx = injected["context"]
        assert "Repository rules for this checkout" in ctx
        assert "Use pnpm, not npm" in ctx
        assert "Do not edit generated files under dist/" in ctx

    def test_noops_outside_repo(self, tmp_path, monkeypatch):
        pi = _load_plugin_init()
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("TERMINAL_CWD", raising=False)
        injected = pi._on_pre_llm_call(user_message="hi")
        assert injected is None


class TestBundledDiscovery:
    def _write_enabled_config(self, hermes_home, names):
        import yaml

        cfg_path = hermes_home / "config.yaml"
        cfg_path.write_text(yaml.safe_dump({"plugins": {"enabled": list(names)}}))

    def test_repo_rules_discovered_but_not_loaded_by_default(self, _isolate_hermes_home):
        from hermes_cli import plugins as pmod

        mgr = pmod.PluginManager()
        mgr.discover_and_load()
        assert "repo-rules" in mgr._plugins
        loaded = mgr._plugins["repo-rules"]
        assert loaded.manifest.source == "bundled"
        assert not loaded.enabled
        assert loaded.error and "not enabled" in loaded.error

    def test_repo_rules_loads_when_enabled(self, _isolate_hermes_home):
        self._write_enabled_config(_isolate_hermes_home, ["repo-rules"])
        from hermes_cli import plugins as pmod

        mgr = pmod.PluginManager()
        mgr.discover_and_load()
        loaded = mgr._plugins["repo-rules"]
        assert loaded.enabled
        assert "pre_llm_call" in loaded.hooks_registered
        assert "repo-rule" in loaded.commands_registered
