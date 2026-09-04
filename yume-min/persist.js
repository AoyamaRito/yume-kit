// yume-min / persist.js — 平文で履歴込みの Graph を保存/復元（git 不要）
//
// 動機: AI は git の履歴（.git オブジェクトDB）を「ファイルを読むだけ」では見られない。
// yume-files はそれを「ファイル自身に append-only 履歴を平文で内蔵する」ことで解決した。
// yume-min も同じ動機に応えるため、Graph（versions 含む）を平文 JSON で save/load する。
// - 平文 = そのまま grep / AI が読める（No Hidden State）
// - append-only = Scrap & Build しても過去が残る（time 軸の保存）
// - git 操作を一切要求しない
//
// 履歴は Block 直近32版（core の MAX_HISTORY キャップ）を保持。総数は totalHistory で分かる。

import { Graph, Block } from './core.js';
import { writeFileSync, readFileSync } from 'node:fs';

const FORMAT = 'yume-min';

// save: 平文 JSON へ保存。opts.headOnly=true なら各 Block の最新版のみ（肥大を避け、薄く読む）。
export function save(graph, filePath, opts = {}) {
  const blocks = graph.all().map(b => {
    if (opts.headOnly) {
      // 履歴は吐かず、最新 content だけ。totalHistory は保存しない（軽さ優先）。
      return { id: b.id, type: b.type, head: b.content, meta: b.meta };
    }
    return b.toJSON();
  });
  const data = { format: FORMAT, mode: opts.headOnly ? 'head' : 'full', savedAt: Date.now(), blocks };
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

export function load(filePath) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  if (data.format !== FORMAT) throw new Error(`save format mismatch: ${data.format}`);
  const g = new Graph();
  for (const j of data.blocks) {
    let block;
    if (j.head !== undefined) {          // head モード保存
      block = new Block({ id: j.id, type: j.type, meta: j.meta });
      block.commit({ content: j.head });
    } else {                             // full モード保存（履歴あり）
      block = Block.fromJSON(j);
    }
    g.add(block);
  }
  return g;
}

// readHeads: 全履歴を読まずに各 Block の最新 content だけを薄く返す（スナイパー読解）。
export function readHeads(filePath) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  return data.blocks.map(b => ({ id: b.id, type: b.type, content: b.head !== undefined ? b.head : (b.versions ? b.versions[b.versions.length - 1].content : undefined) }));
}
