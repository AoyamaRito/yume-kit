// yume-min / lift.js — 実コード ⇔ BlockGraph の往復（ai-desk v1 エンブレム方式・言語非依存）
//
// 言語パーサ（parseJS 等）は持たない。やることは「ソース中のマーカー行を走査する」だけ。
// マーカーはコメント行（// か #）だから、JS / TS / Go / C / Ruby / Python / md… 
// どの言語でも同じ境界を書けて同じように読める（＝単一作者の透明編集）。
//
//   const { graph, spans } = lift(source);       // 実ファイル → 正本Graph
//   const view = expand(graph, root);            // 単一AIが厚ビューで編集
//   apply(graph, root, edited);                  // 新バージョンを append
//   const out = render(source, graph, spans);    // 更新後の本文で実ファイルを再構築
//
// 非ブロック領域（import / 外周のシェル）はそのまま保持される＝ローカリティ。

import { Graph, Block, hash } from './core.js';

const OPEN = /^\s*(\/\/|#)\s*>>>\s+BLOCK\s+(\S+)(?:\s+(.*))?\s*$/;
const CLOSE = /^\s*(?:\/\/|#)\s*<<<\s+\/BLOCK\s+(\S+)(?:\s+(.*))?\s*$/;

// マーカー走査で実ソースを BlockGraph に引き上げる。
export function lift(source) {
  const lines = String(source).split('\n');
  const spans = [];
  let cur = null, buf = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(OPEN))) {
      if (cur) { spans.push({ id: cur.id, type: cur.type, marker: cur.marker, startLine: cur.openLine, endLine: i, body: buf.join('\n') }); }
      // m[1]=marker(//|#), m[2]=id, m[3]=属性文字列(type=.. hash=..)
      const attrs = m[3] ? Object.fromEntries([...String(m[3]).matchAll(/(\w+)=(\S+)/g)].map(x => [x[1], x[2]])) : {};
      cur = { id: m[2], type: attrs.type || 'block', marker: m[1], openLine: i };
      buf = [];
      continue;
    }
    if ((m = line.match(CLOSE))) {
      if (cur && cur.id === m[1]) {
        spans.push({ id: cur.id, type: cur.type, marker: cur.marker, startLine: cur.openLine, endLine: i, body: buf.join('\n') });
        cur = null; buf = [];
      }
      continue;
    }
    if (cur) buf.push(line);
  }
  if (cur) spans.push({ id: cur.id, type: cur.type, marker: cur.marker, startLine: cur.openLine, endLine: lines.length - 1, body: buf.join('\n') });

  const graph = new Graph();
  for (const s of spans) {
    const b = new Block({ id: s.id, type: s.type });
    b.commit({ content: s.body });
    graph.add(b);
  }
  return { graph, spans };
}

function bodyHash(id, type, content) {
  return hash(id + '\0' + type + '\0' + (content ?? ''));
}

// 正本Graphの最新内容（head）で実ソースを再構築する。非ブロック領域は保持。
export function render(source, graph, spans) {
  const lines = String(source).split('\n');
  // 後ろから置換して行番号オフセットを崩さない
  const ordered = [...spans].sort((a, b) => b.startLine - a.startLine);
  for (const s of ordered) {
    const b = graph.get(s.id);
    const content = b ? (b.content ?? '') : s.body;
    const h = bodyHash(s.id, s.type, content);
    const bodyLines = content === '' ? [] : content.split('\n');
    const open = `${s.marker || '//'} >>> BLOCK ${s.id} type=${s.type} hash=${h}`;
    const close = `${s.marker || '//'} <<< /BLOCK ${s.id} hash=${h}`;
    const newSeg = [open, ...bodyLines, close];
    lines.splice(s.startLine, s.endLine - s.startLine + 1, ...newSeg);
  }
  return lines.join('\n');
}
