/* PyEditor Web — Python worker (Pyodide). Stop = worker.terminate() on the page side,
   the same idea as killProcess() of the :python process in the Android build. */
"use strict";
let py = null, mode = "replay", skip = 0, produced = 0, buf = "", lastFlush = 0, pendingAsk = null;

const PY_RUNNER = String.raw`
import sys, io, builtins, traceback, linecache
import _host

class _Out(io.TextIOBase):
    def __init__(self, err): self._err = err
    def writable(self): return True
    def write(self, s):
        if s: _host.out(str(s), self._err)
        return len(s)
    def flush(self): pass

class _NeedInput(BaseException):
    pass

_MODE = "replay"
_QUEUE = []

def _read_line():
    if _MODE == "jspi":
        from pyodide.ffi import run_sync
        v = run_sync(_host.ask())
        return None if v is None else str(v)
    if _QUEUE:
        return _QUEUE.pop(0)
    raise _NeedInput()

class _In(io.TextIOBase):
    def readable(self): return True
    def readline(self, size=-1):
        v = _read_line()
        return "" if v is None else v + "\n"

def _input(prompt=""):
    if prompt:
        sys.stdout.write(str(prompt))
    line = sys.stdin.readline()
    if line == "":
        raise EOFError("EOF when reading a line")
    return line[:-1] if line.endswith("\n") else line

def _report_runtime(e):
    tb = e.__traceback__
    user_tb = (tb.tb_next if tb is not None else None) or tb
    sys.stderr.write("".join(traceback.format_exception(type(e), e, user_tb)))
    line = 0
    for fr in traceback.extract_tb(user_tb):
        if fr.filename == "<editor>":
            line = fr.lineno
    return line

def run(code, mode, queue, seed):
    global _MODE, _QUEUE
    _MODE = mode
    _QUEUE = [str(x) for x in queue]
    old = sys.stdout, sys.stderr, sys.stdin, builtins.input
    sys.stdout, sys.stderr, sys.stdin, builtins.input = _Out(False), _Out(True), _In(), _input
    try:
        if seed is not None:
            import random
            random.seed(seed)
        linecache.cache["<editor>"] = (len(code), None, code.splitlines(True), "<editor>")
        try:
            compiled = compile(code, "<editor>", "exec")
        except SyntaxError as e:
            sys.stderr.write("".join(traceback.format_exception_only(type(e), e)))
            return "error:%d" % (e.lineno or 0)
        try:
            exec(compiled, {"__name__": "__main__", "__builtins__": builtins})
        except _NeedInput:
            return "need-input"
        except SystemExit:
            pass
        except BaseException as e:
            return "error:%d" % _report_runtime(e)
        return "ok"
    finally:
        sys.stdout.flush()
        sys.stdout, sys.stderr, sys.stdin, builtins.input = old

def check_syntax(code):
    try:
        compile(code, "<editor>", "exec")
        return ""
    except SyntaxError as e:
        return "%d\t%s" % (e.lineno or 0, e.msg or "syntax error")
    except Exception:
        return ""

def can_jspi():
    try:
        from pyodide.ffi import can_run_sync
        return bool(can_run_sync())
    except Exception:
        return False
`;

function flush() {
  if (buf) { postMessage({type: "out", text: buf}); buf = ""; }
  lastFlush = performance.now();
}

const host = {
  out(text, isErr) {
    let s = String(text);
    produced += s.length;
    if (skip > 0) {                       // replay mode: drop what is already on screen
      if (s.length <= skip) { skip -= s.length; return; }
      s = s.slice(skip); skip = 0;
    }
    if (isErr) { flush(); postMessage({type: "out", text: s, err: true}); return; }
    buf += s;
    if (buf.length > 8192 || performance.now() - lastFlush > 40) flush();
  },
  ask() {
    flush();
    postMessage({type: "need-input"});
    return new Promise(res => { pendingAsk = res; });
  },
};

async function init(bases, forceMode) {
  let lastErr = null;
  for (const base of bases) {
    try {
      postMessage({type: "status", key: "loading"});
      const {loadPyodide} = await import(base + "pyodide.mjs");
      py = await loadPyodide({indexURL: base});
      py.registerJsModule("_host", host);
      py.runPython(PY_RUNNER);
      const jspi = py.globals.get("can_jspi")();
      mode = forceMode || (jspi ? "jspi" : "replay");
      const pyver = String(py.runPython("import sys; sys.version.split()[0]"));
      postMessage({type: "ready", version: pyver, mode});
      return;
    } catch (e) { lastErr = e; }
  }
  postMessage({type: "load-error", msg: String(lastErr && lastErr.message || lastErr)});
}

async function run(msg) {
  skip = msg.skip || 0; produced = 0; buf = ""; lastFlush = performance.now();
  try {
    try {
      await py.loadPackagesFromImports(msg.code, {
        messageCallback: m => /Loading|Loaded/.test(m) && postMessage({type: "status", key: "packages", text: m}),
        errorCallback: () => {},
      });
    } catch (_) { /* unknown imports surface as ModuleNotFoundError */ }
    py.globals.set("__code", msg.code);
    py.globals.set("__mode", mode);
    py.globals.set("__queue", py.toPy(msg.queue || []));
    py.globals.set("__seed", msg.seed ?? null);
    const r = mode === "jspi"
      ? await py.runPythonAsync("run(__code, __mode, __queue, __seed)")
      : py.runPython("run(__code, __mode, __queue, __seed)");
    flush();
    const status = String(r);
    if (status.startsWith("error:")) postMessage({type: "done", status: "error", line: +status.slice(6)});
    else if (status === "need-input") postMessage({type: "need-input", replay: true, produced});
    else postMessage({type: "done", status: "ok"});
  } catch (e) {
    flush();
    postMessage({type: "out", text: String(e && e.message || e) + "\n", err: true});
    postMessage({type: "done", status: "error", line: 0});
  }
}

onmessage = e => {
  const m = e.data;
  if (m.type === "init") init(m.bases, m.forceMode);
  else if (m.type === "run") run(m);
  else if (m.type === "input" && pendingAsk) { const r = pendingAsk; pendingAsk = null; r(m.value); }
  else if (m.type === "check" && py) {
    const r = String(py.globals.get("check_syntax")(m.code));
    const tab = r.indexOf("\t");
    postMessage({type: "syntax", seq: m.seq, line: r ? +r.slice(0, tab) : 0, msg: r ? r.slice(tab + 1) : ""});
  }
};
