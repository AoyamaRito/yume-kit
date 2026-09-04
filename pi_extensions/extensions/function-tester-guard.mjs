// @why: function-testerが指定テストファイル以外をwrite/editツールで変更しないよう、子piプロセス側でも機械的に境界を設ける。
// @why: [2026-08-27] 旧 @why の「bashは許可」は実装と乖離していたので訂正：現行は `--tools read,write,edit` で bash を渡さず、
//        tester 自身は shell を持たない。unit test の実行は親ラッパー（function-tester.ts の runTester）が担い、
//        実測結果を Evidence として報告に付加する（Evidence over Claims）。read も許可リスト外をブロックする。
// @tags: SPEC
import path from "node:path";

const allowedWrite = path.resolve(process.env.YUME_FUNCTION_TESTER_TEST_FILE || "");
const allowedRead = new Set(
  JSON.parse(process.env.YUME_FUNCTION_TESTER_ALLOWED_FILES || "[]").map((file) => path.resolve(file)),
);

export default function (pi) {
  pi.on("tool_call", (event) => {
    const requested = event.input?.path || event.input?.file_path;
    const actual = requested ? path.resolve(requested) : "";

    if (event.toolName === "read") {
      if (!allowedRead.has(actual)) {
        return {
          block: true,
          reason: `function-tester policy: only explicitly allowed files may be read (${actual})`,
        };
      }
      return;
    }

    if (event.toolName !== "write" && event.toolName !== "edit") return;
    if (actual !== allowedWrite) {
      return {
        block: true,
        reason: `function-tester policy: only ${allowedWrite} may be written`,
      };
    }
  });
}
