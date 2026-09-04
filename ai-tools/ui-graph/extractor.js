// @why: [2026-09-06] ui-graph（ai-tools）と yui（yume-spec）で extractor.js が 2 コピー存在し、分岐していた
//       （ai-tools 旧版 431 行 vs yume-spec 進化版 464 行。進化版には SVG誤検出防止・<option>除外・非表示祖先検出など 7 つの改善）。
//       正本を yume-spec/ui/extractor.js に一本化し、ここは互換のための薄い re-export とする（import 書き換え 0 箇所で済む最小変更）。
//       実体は ../../yume-spec/ui/extractor.js（yume-kit 一体運用が前提。単体コピー時は実体も同梱すること）。
// @tags: SPEC
export { extractUIGraph } from '../../ui/extractor.js';