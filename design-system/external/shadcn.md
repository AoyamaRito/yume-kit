# shadcn/ui + Radix（オフライン要約）

## 位置づけ

- 2024–2026 の Web UI の“標準感”の中心
- **npm で黒箱依存せず、コンポーネントをリポジトリにコピーして所有する**
- 見た目: Tailwind + CSS 変数
- 振る舞い: **Radix Primitives**（a11y・キーボード・フォーカス）

## 原則（shadcn 側）

1. Open Code — ソースを読める・直せる
2. Composition — 組み合わせで作る
3. Distribution — CLI / registry で配布
4. Beautiful Defaults — 初期見た目がすでに良い
5. AI-Ready — v0 等と相性が良い

## 盗むべき構造

```
:root {
  /* 中立なセマンティック名 */
  --background
  --foreground
  --primary / --primary-foreground
  --secondary
  --muted / --muted-foreground
  --accent
  --destructive
  --border / --input / --ring
  --radius
}
```

- light / dark を同名変数の差し替えで切り替え
- コンポーネントは variants（size / intent）を CVA 的に持つ

## Radix から盗むこと

- 見た目ではなく **対話パターン**（Dialog, Dropdown, Tabs, Toast…）
- ARIA・フォーカス・Escape・外側クリックの標準挙動

## ローカルへの当てはめ

- 新 SaaS / 管理画面 → `tokens/` を shadcn 風セマンティック名に寄せると後が楽
- 既存 14U はプレゼン特化なので、アプリ UI とはトークン空間を分ける
