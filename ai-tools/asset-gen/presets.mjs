// @why: [2026-08-28] 2Dイラスト・アセット生成用の高品質プロンプト定義・モデルマッピング・プリセットを一元管理。
// @why: [2026-08-29] キャラクター同一性（Identity Consistency）および絵柄保持（Style Consistency）のプリセット・表情/ポーズ辞書を追加。
// @why: [2026-08-29] 最高峰モデル（Recraft v3, Flux 1.1 Pro Ultra, Flux 1.1 Pro, Flux Dev）を標準採用し画質と精度を最大化。
// @tags: SPEC

export const EXPRESSIONS = {
  'neutral': 'neutral expression, calm look',
  'happy': 'happy smiling expression, cheerful, bright smile',
  'angry': 'angry expression, furrowed brows, fierce fierce glare',
  'sad': 'sad expression, sorrowful, downcast eyes, melancholic',
  'surprised': 'surprised expression, wide eyes, gasp, astonished',
  'serious': 'serious determined expression, sharp focused gaze, resolute',
  'blushing': 'blushing shy expression, red cheeks, embarrassed cute look',
  'smug': 'smug confident grin, mischievous sly expression',
  'wink': 'winking eye, playful teasing cute expression',
  'crying': 'crying tears in eyes, emotional weeping face',
  'shouting': 'battle cry shouting with open mouth, fiery expression',
  // 日本語エイリアス
  '通常': 'neutral expression, calm look',
  '笑顔': 'happy smiling expression, cheerful, bright smile',
  '怒り': 'angry expression, furrowed brows, fierce fierce glare',
  '悲しみ': 'sad expression, sorrowful, downcast eyes, melancholic',
  '驚き': 'surprised expression, wide eyes, gasp, astonished',
  '真剣': 'serious determined expression, sharp focused gaze, resolute',
  '照れ': 'blushing shy expression, red cheeks, embarrassed cute look',
  'ドヤ顔': 'smug confident grin, mischievous sly expression',
  'ウインク': 'winking eye, playful teasing cute expression',
  '泣き': 'crying tears in eyes, emotional weeping face',
  '叫び': 'battle cry shouting with open mouth, fiery expression',
};

export const POSES = {
  'idle': 'standing idle relaxed pose, full body view, clean stance',
  'attack': 'dynamic action combat attack pose, swinging weapon, energetic movement',
  'defense': 'defensive shielding pose, guarding stance, bracing for impact',
  'casting': 'magic casting pose, hands glowing with magical aura, spell incantation',
  'victory': 'triumphant victory pose, cheering, confident posture',
  'hurt': 'damaged recoil pose, staggering back, wounded reaction',
  'jump': 'mid-air jumping dynamic action pose, flying silhouette',
  'sit': 'sitting relaxed pose, casual posture',
  // 日本語エイリアス
  '待機': 'standing idle relaxed pose, full body view, clean stance',
  '攻撃': 'dynamic action combat attack pose, swinging weapon, energetic movement',
  '防御': 'defensive shielding pose, guarding stance, bracing for impact',
  '詠唱': 'magic casting pose, hands glowing with magical aura, spell incantation',
  '勝利': 'triumphant victory pose, cheering, confident posture',
  '被弾': 'damaged recoil pose, staggering back, wounded reaction',
  'ジャンプ': 'mid-air jumping dynamic action pose, flying silhouette',
  '座り': 'sitting relaxed pose, casual posture',
};

export const PRESETS = {
  'vector-icon': {
    name: 'vector-icon',
    desc: '【Recraft v3】ベクター形式のゲームアイコン・アイテム（SVG出力・拡大自在）',
    model: 'fal-ai/recraft-v3',
    style: 'vector_illustration',
    image_size: 'square_hd',
    promptTemplate: (p) => `2D game asset icon of ${p}, vector art style, clean sharp outline, vibrant flat colors, isolated on plain white background, premium game item design`,
  },
  'game-item': {
    name: 'game-item',
    desc: '【Recraft v3】RPG・ゲーム用のアイテム・装備・宝箱（クリーンな2Dデジタルアート）',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'square_hd',
    promptTemplate: (p) => `2D game item illustration of ${p}, crisp digital art, sharp details, fantasy RPG asset, isolated on clean background`,
  },
  'pixel-art': {
    name: 'pixel-art',
    desc: '【Flux Dev】16/32-bit レトロゲーム風ドット絵・スプライト（高精細）',
    model: 'fal-ai/flux/dev',
    image_size: 'square_hd',
    promptTemplate: (p) => `16-bit pixel art sprite of ${p}, retro 2D game asset, crisp pixel edges, clear color palette, isolated on plain background, masterwork pixel art`,
  },
  'anime-char': {
    name: 'anime-char',
    desc: '【Recraft v3】アニメ・ゲーム風キャラクター立ち絵（セル画調・高精細）',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'portrait_4_3',
    promptTemplate: (p) => `2D anime style character illustration of ${p}, cel-shaded, clean lineart, character design concept, dynamic pose, game asset, simple clean background`,
  },
  'char-base': {
    name: 'char-base',
    desc: '【Recraft v3】キャラクター基準立ち絵（全身・高精細・同一性保持のベース用）',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'portrait_4_3',
    promptTemplate: (p) => `Masterpiece 2D anime character design reference sheet of ${p}, full body standing portrait, neutral clean pose, precise detailed costume and hairstyle, crisp lines, cel shaded anime art, isolated on plain white background`,
  },
  'char-expression': {
    name: 'char-expression',
    desc: '【Recraft v3】同一キャラクター表情差分（笑顔・怒り・驚き・照れ等）',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'portrait_4_3',
    promptTemplate: (p, exp = 'happy') => {
      const expDesc = EXPRESSIONS[exp] || exp;
      return `Masterpiece 2D anime character portrait of ${p}, ${expDesc}, close-up bust shot, exact same hair style and eye color and outfit, crisp lines, cel shaded anime art, isolated on plain white background`;
    },
  },
  'char-pose': {
    name: 'char-pose',
    desc: '【Recraft v3】同一キャラクターポーズ・アクション差分（攻撃・防御・詠唱・勝利等）',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'portrait_4_3',
    promptTemplate: (p, pose = 'attack') => {
      const poseDesc = POSES[pose] || pose;
      return `Masterpiece 2D anime character action shot of ${p}, ${poseDesc}, exact same facial features and costume design, dynamic composition, cel shaded anime art, isolated on plain white background`;
    },
  },
  'char-pixel': {
    name: 'char-pixel',
    desc: '【Flux Dev】同一キャラクターの16-bitドット絵スプライト化（高精細）',
    model: 'fal-ai/flux/dev',
    image_size: 'square_hd',
    promptTemplate: (p) => `16-bit pixel art character sprite of ${p}, retro 2D game asset, crisp pixel edges, faithful costume and hair colors, full body sprite, isolated on plain background`,
  },
  'char-chibi': {
    name: 'char-chibi',
    desc: '【Recraft v3】同一キャラクターのSD・ちびキャラ化',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'square_hd',
    promptTemplate: (p) => `Super deformed chibi 2D character illustration of ${p}, big head small cute body, faithful character costume and hair details, vibrant cel-shaded style, isolated on white background`,
  },
  'style-consistent': {
    name: 'style-consistent',
    desc: '【Recraft v3】スタイル参照（Style Reference）による絵柄完全保持アセット生成',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'square_hd',
    promptTemplate: (p) => `2D game asset illustration of ${p}, matched art style and coloring, crisp details, isolated on clean background`,
  },
  'flagship-art': {
    name: 'flagship-art',
    desc: '【Flux 1.1 Pro Ultra】最上位フラグシップ超高精細2Dアート・コンセプトアート',
    model: 'fal-ai/flux-pro/v1.1-ultra',
    image_size: 'landscape_16_9',
    promptTemplate: (p) => `Masterpiece 2D concept artwork of ${p}, stunning details, breathtaking composition, cinematic lighting, masterpiece digital illustration`,
  },
  'pro-anime': {
    name: 'pro-anime',
    desc: '【Flux 1.1 Pro】最先端プロフェッショナルアニメ・キャラクターイラスト',
    model: 'fal-ai/flux-pro/v1.1',
    image_size: 'portrait_4_3',
    promptTemplate: (p) => `Masterpiece 2D anime digital illustration of ${p}, high detail anime aesthetic, sharp lineart, vibrant vivid color palette, dynamic lighting, professional key visual art`,
  },
  'chibi': {
    name: 'chibi',
    desc: '【Recraft v3】SD・ちびキャラの2Dスプライト・マスコット',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'square_hd',
    promptTemplate: (p) => `Chibi SD character illustration of ${p}, cute 2D game sprite, big head small body, vibrant colors, clean lines, isolated on white background`,
  },
  'monster': {
    name: 'monster',
    desc: '【Recraft v3】RPG用モンスター・エネミースプライト',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    image_size: 'square_hd',
    promptTemplate: (p) => `2D fantasy RPG enemy monster sprite of ${p}, battle asset, creature design, high detail digital illustration, isolated on plain background`,
  },
  'background': {
    name: 'background',
    desc: '【Flux 1.1 Pro】横スクロール・ノベル・ゲーム用最高峰2D背景アート',
    model: 'fal-ai/flux-pro/v1.1',
    image_size: 'landscape_16_9',
    promptTemplate: (p) => `2D side-scrolling game background art of ${p}, digital painting, layered scenery, atmospheric lighting, high quality concept landscape`,
  },
  'ui-frame': {
    name: 'ui-frame',
    desc: '【Recraft v3】ゲームUI用フレーム・バナー・ボタン・装飾枠（SVG出力）',
    model: 'fal-ai/recraft-v3',
    style: 'vector_illustration',
    image_size: 'landscape_4_3',
    promptTemplate: (p) => `2D game UI element, ${p}, decorative ornate border frame, vector art style, clean interface design, isolated on white background`,
  },
  'texture': {
    name: 'texture',
    desc: '【Flux Dev】2Dゲーム用シームレスタイル・テクスチャ（草・石・木・レンガなど）',
    model: 'fal-ai/flux/dev',
    image_size: 'square_hd',
    promptTemplate: (p) => `Top-down 2D seamless repeating texture pattern of ${p}, game map tile, vibrant, hand-painted texture style`,
  },
  'raw': {
    name: 'raw',
    desc: '【Flux Dev】プリセット加工なし（プロンプト直渡し）',
    model: 'fal-ai/flux/dev',
    image_size: 'square_hd',
    promptTemplate: (p) => p,
  }
};

export const MODEL_ALIASES = {
  // 最上位フラグシップ (Pro Ultra / Pro)
  'ultra': 'fal-ai/flux-pro/v1.1-ultra',
  'pro-ultra': 'fal-ai/flux-pro/v1.1-ultra',
  'flux-ultra': 'fal-ai/flux-pro/v1.1-ultra',
  'flux-pro-ultra': 'fal-ai/flux-pro/v1.1-ultra',
  'pro': 'fal-ai/flux-pro/v1.1',
  'flux-pro': 'fal-ai/flux-pro/v1.1',
  'flux-pro-v1.1': 'fal-ai/flux-pro/v1.1',

  // 高精細オープンウェイト (Dev / 28 steps)
  'dev': 'fal-ai/flux/dev',
  'flux': 'fal-ai/flux/dev',
  'flux-dev': 'fal-ai/flux/dev',

  // ベクター & デジタルイラスト最高峰 (Recraft v3)
  'recraft': 'fal-ai/recraft-v3',
  'recraft-v3': 'fal-ai/recraft-v3',
  'recraft-vector': 'fal-ai/recraft-v3',
  'recraft-digital': 'fal-ai/recraft-v3',
  'recraft-20b': 'fal-ai/recraft-20b',

  // 高速軽量版 (Schenll / 4 steps - テスト・ドラフト用)
  'schnell': 'fal-ai/flux/schnell',
  'flux-schnell': 'fal-ai/flux/schnell',

  // キャラクター/同一性・参照特化
  'flux-i2i': 'fal-ai/flux/dev/image-to-image',
  'flux-pulid': 'fal-ai/flux-pulid',

  // デザイン・文字特化
  'ideogram': 'fal-ai/ideogram/v2',
  'ideogram-v2': 'fal-ai/ideogram/v2',

  // アップスケーラー
  'clarity': 'fal-ai/clarity-upscaler',
  'upscale': 'fal-ai/clarity-upscaler',
  'esrgan': 'fal-ai/esrgan',
};
