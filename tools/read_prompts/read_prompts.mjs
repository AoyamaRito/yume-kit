// read_prompts — プロンプトの目次・詳細読み出し CLI
// @why: [2026-09-06] 長いシステムプロンプトは LLM に読み飛ばされる（lost in the middle）。
//       注入は最小限にし、必要な時に stdout へ検索・要約を吐き出すことで、読み飛ばしを可能にする。
// @tags: SPEC, prompts, read
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロンプトは同梱冗長の原則で tools/read_prompts/../.. ではなく yume-kit/prompts/ を指す。
// @why: [2026-09-06] 冗長性尊重（clearify）。yume-kit 直下の prompts/ が正本。tools/ は入口。
const PROMPTS_DIR = path.resolve(__dirname, '../../prompts');

function listPrompts() {
  const prompts = fs.readdirSync(PROMPTS_DIR)
    .filter(file => file.endsWith('.md'))
    .sort();

  if (prompts.length === 0) {
    console.log("No prompts found in the prompts directory.");
    return;
  }

  console.log("Available prompts (use `read_prompts.mjs <name>` to read full content):");
  prompts.forEach(file => {
    const name = path.basename(file, '.md');
    try {
      const content = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8');
      const firstLine = content.split('\n')[0].trim();
      console.log(`- ${name}: ${firstLine}`);
    } catch (error) {
      console.error(`Error reading ${file}: ${error.message}`);
    }
  });
}

function readPrompt(name) {
  // 部分一致も許す（例: "core" → 00_core.md）
  const candidates = fs.readdirSync(PROMPTS_DIR)
    .filter(file => file.endsWith('.md'))
    .filter(file => {
      const base = path.basename(file, '.md');
      const norm = base.replace(/^\d+_/, '');
      return base === name || norm === name || norm.includes(name);
    })
    .sort();

  if (candidates.length === 0) {
    console.error(`Prompt "${name}" not found.`);
    console.error("Use `read_prompts.mjs` (no args) to list available prompts.");
    process.exit(1);
  }

  const file = candidates[0];
  try {
    const content = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8');
    console.log(content);
  } catch (error) {
    console.error(`Error reading prompt "${name}": ${error.message}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);

if (args.length === 0) {
  listPrompts();
} else {
  readPrompt(args[0]);
}