// CodeMirror 6 bundle for PyEditor Web. Exposes window.PyEd.create(parent, opts).
import {EditorState, StateField, StateEffect, Compartment} from "@codemirror/state";
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, Decoration, highlightSpecialChars} from "@codemirror/view";
import {defaultKeymap, history, historyKeymap, indentWithTab, undo, redo} from "@codemirror/commands";
import {python} from "@codemirror/lang-python";
import {HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, indentUnit} from "@codemirror/language";
import {closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap} from "@codemirror/autocomplete";
import {searchKeymap, highlightSelectionMatches} from "@codemirror/search";
import {tags as t} from "@lezer/highlight";

const hl = HighlightStyle.define([
  {tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--syn-kw)", fontWeight: "600"},
  {tag: [t.string, t.special(t.string)], color: "var(--syn-str)"},
  {tag: [t.number, t.bool, t.null], color: "var(--syn-num)"},
  {tag: [t.comment, t.lineComment], color: "var(--syn-com)", fontStyle: "italic"},
  {tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: "var(--syn-fn)"},
  {tag: [t.definition(t.className), t.className], color: "var(--syn-cls)"},
  {tag: [t.self, t.special(t.variableName)], color: "var(--syn-self)"},
  {tag: [t.operator, t.punctuation, t.bracket], color: "var(--syn-op)"},
  {tag: t.invalid, color: "var(--danger)"},
]);

const setErr = StateEffect.define();
const errField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setErr)) {
      if (e.value == null) deco = Decoration.none;
      else {
        const n = Math.min(Math.max(1, e.value), tr.state.doc.lines);
        deco = Decoration.set([Decoration.line({class: "cm-errline"}).range(tr.state.doc.line(n).from)]);
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

const baseTheme = EditorView.theme({
  "&": {height: "100%", color: "var(--code-ink)", backgroundColor: "var(--code-bg)"},
  ".cm-scroller": {fontFamily: "var(--mono)", lineHeight: "1.55", overscrollBehavior: "contain"},
  ".cm-content": {caretColor: "var(--accent)", padding: "10px 0 40vh"},
  ".cm-cursor, .cm-dropCursor": {borderLeftColor: "var(--accent)", borderLeftWidth: "2px"},
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {backgroundColor: "var(--sel) !important"},
  ".cm-gutters": {backgroundColor: "var(--code-bg)", color: "var(--gutter)", border: "none", paddingLeft: "4px"},
  ".cm-activeLine": {backgroundColor: "var(--active-line)"},
  ".cm-activeLineGutter": {backgroundColor: "transparent", color: "var(--code-ink)"},
  ".cm-matchingBracket": {backgroundColor: "var(--sel)", outline: "1px solid var(--accent)"},
  ".cm-errline": {backgroundColor: "var(--err-line)", textDecoration: "underline wavy var(--danger)", textUnderlineOffset: "4px"},
  ".cm-tooltip": {backgroundColor: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)"},
  ".cm-tooltip-autocomplete ul li[aria-selected]": {backgroundColor: "var(--accent)", color: "#111"},
  ".cm-panels": {backgroundColor: "var(--panel)", color: "var(--ink)"},
  ".cm-foldGutter span": {color: "var(--gutter)"},
});

function create(parent, opts = {}) {
  const fontC = new Compartment();
  const fontTheme = px => EditorView.theme({"&": {fontSize: px + "px"}});
  let fontPx = opts.fontSize || 16;
  // One EditorState per tab: each keeps its own text, undo history, selection and scroll.
  const extensions = () => [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(),
    drawSelection(), EditorState.allowMultipleSelections.of(true), indentOnInput(), indentUnit.of("    "),
    syntaxHighlighting(hl), bracketMatching(), closeBrackets(), autocompletion(), highlightActiveLine(),
    highlightSelectionMatches(), python(), errField, baseTheme, fontC.of(fontTheme(fontPx)),
    EditorView.contentAttributes.of({autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "Python code"}),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab,
      {key: "Mod-Enter", run: () => { opts.onRun && opts.onRun(); return true; }},
      {key: "Mod-s", run: () => { opts.onSave && opts.onSave(); return true; }}]),
    EditorView.updateListener.of(u => { if (u.docChanged && opts.onChange) opts.onChange(); }),
  ];
  const newState = doc => EditorState.create({doc: doc || "", extensions: extensions()});
  const view = new EditorView({parent, state: newState(opts.doc)});
  const scrollPos = new WeakMap();
  return {
    view,
    newState,
    getState: () => view.state,
    setState(state) {
      scrollPos.set(view.state, view.scrollDOM.scrollTop);
      view.setState(state);
      // a tab created before a font change still carries the old size
      view.dispatch({effects: fontC.reconfigure(fontTheme(fontPx))});
      const top = scrollPos.get(state);
      requestAnimationFrame(() => { view.scrollDOM.scrollTop = top || 0; });
    },
    getText: () => view.state.doc.toString(),
    setText(text) {
      view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: text}, selection: {anchor: 0}, effects: setErr.of(null)});
    },
    insert(text, caret) {
      const r = view.state.selection.main;
      view.dispatch({changes: {from: r.from, to: r.to, insert: text}, selection: {anchor: r.from + (caret ?? text.length)}, scrollIntoView: true});
      view.focus();
    },
    setError(line) { view.dispatch({effects: setErr.of(line || null)}); },
    gotoLine(n) {
      const ln = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
      view.dispatch({selection: {anchor: ln.from}, effects: EditorView.scrollIntoView(ln.from, {y: "center"})});
      view.focus();
    },
    setFontSize(px) { fontPx = px; view.dispatch({effects: fontC.reconfigure(fontTheme(px))}); },
    undo: () => undo(view), redo: () => redo(view),
    focus: () => view.focus(),
  };
}

window.PyEd = {create};
