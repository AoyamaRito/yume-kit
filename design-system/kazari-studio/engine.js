// @why: design/PHILOSOPHY.md の単機能・直列思想に基づき、プロ品質の飾り文字（タイトル・見出し・ロゴ）を Canvas/SVG/CSS/Unicode で瞬時に生成する独立描画コア
// @tags: SPEC, KAZARI_ENGINE, TYPOGRAPHY, SVG_EXPORT, MULTI_STROKE, 3D_EMBOSS, FIBONACCI

/**
 * 飾り文字生成エンジン (KazariEngine)
 * - Canvas 2D 描画（高解像度透過PNG書き出し対応）
 * - ベクター SVG 生成（拡大無劣化）
 * - CSS スニペット生成（Webコピペ用）
 * - Unicode 装飾テキスト生成（SNS/チャット用）
 * - 縦書き／横書き 約物置換・ルビ・サブタイトル・落款・オーナメント合成
 */

var KazariEngine = (function () {
  'use strict';

  // roundRect ポリフィル（古いブラウザや環境向け）
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
      if (!radii) radii = 0;
      const r = typeof radii === 'number' ? radii : (Array.isArray(radii) ? (radii[0] || 0) : 0);
      const safeR = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + safeR, y);
      this.arcTo(x + w, y, x + w, y + h, safeR);
      this.arcTo(x + w, y + h, x, y + h, safeR);
      this.arcTo(x, y + h, x, y, safeR);
      this.arcTo(x, y, x + w, y, safeR);
      this.closePath();
      return this;
    };
  }

  // 縦書き時の約物・回転・オフセット変換テーブル
  const VERTICAL_GLYPH_MAP = {
    'ー': '丨',
    '―': '丨',
    '—': '丨',
    '-': '丨',
    '～': 'vertical-tilde',
    '~': 'vertical-tilde',
    '（': '︵',
    '）': '︶',
    '(': '︵',
    ')': '︶',
    '〔': '︹',
    '〕': '︺',
    '【': '︻',
    '】': '︼',
    '［': '﹇',
    '］': '﹈',
    '[': '﹇',
    ']': '﹈',
    '｛': '︷',
    '｝': '︸',
    '{': '︷',
    '}': '︸',
    '〈': '︿',
    '〉': '﹀',
    '《': '︽',
    '》': '︾',
    '「': '﹁',
    '」': '﹂',
    '『': '﹃',
    '』': '﹄',
    '…': 'vertical-ellipsis',
    '‥': 'vertical-two-dots',
    '＝': 'vertical-equals',
    '=': 'vertical-equals'
  };

  // 促音・小書き文字・句読点（縦書き時に右上寄り配置）
  const SMALL_KANA_SET = new Set([
    'っ', 'ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゎ',
    'ッ', 'ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ヮ', 'ヵ', 'ヶ',
    '、', '。', '，', '．'
  ]);

  // 8大プリセット定義（Sane Defaults 80点）
  const PRESETS = {
    'sumi-seal': {
      id: 'sumi-seal',
      name: '墨漆と落款',
      desc: '伝統の墨黒・朱の落款（角印）・和モダンな品格',
      fontCategory: 'serif',
      fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
      fontWeight: '800',
      fill: {
        type: 'gradient',
        angle: 90,
        stops: [
          { offset: 0, color: '#111111' },
          { offset: 0.5, color: '#242424' },
          { offset: 1, color: '#0d0d0d' }
        ]
      },
      strokes: [
        { width: 4, color: 'rgba(255, 255, 255, 0.95)', blur: 0 },
        { width: 9, color: 'rgba(24, 24, 24, 0.45)', blur: 4 }
      ],
      shadow3d: {
        depth: 2,
        angle: 135,
        color: 'rgba(0, 0, 0, 0.25)',
        shadowBlur: 8,
        shadowColor: 'rgba(0, 0, 0, 0.35)'
      },
      glow: { enabled: false },
      ornaments: {
        seal: { show: true, text: '極', color: '#D9381E' },
        crown: { show: false },
        spine: { show: true, color: '#D9381E' },
        ribbons: { show: false },
        particles: { show: false },
        brackets: { show: false }
      }
    },
    'gold-brass': {
      id: 'gold-brass',
      name: '金箔と真鍮',
      desc: '黄金メタリックグラデーション・3Dベベル彫刻・格調高い輝き',
      fontCategory: 'serif',
      fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
      fontWeight: '900',
      fill: {
        type: 'gradient',
        angle: 45,
        stops: [
          { offset: 0, color: '#FFEAA7' },
          { offset: 0.25, color: '#DFB15B' },
          { offset: 0.5, color: '#FFF8E7' },
          { offset: 0.75, color: '#C59A3F' },
          { offset: 1, color: '#8C6721' }
        ]
      },
      strokes: [
        { width: 3, color: '#5A4010', blur: 0 },
        { width: 7, color: 'rgba(255, 234, 167, 0.6)', blur: 3 }
      ],
      shadow3d: {
        depth: 4,
        angle: 120,
        color: '#422F07',
        shadowBlur: 13,
        shadowColor: 'rgba(30, 20, 5, 0.5)'
      },
      glow: { enabled: true, color: 'rgba(255, 215, 0, 0.4)', blur: 16 },
      ornaments: {
        seal: { show: false },
        crown: { show: true, color: '#DFB15B' },
        spine: { show: true, color: '#C59A3F' },
        ribbons: { show: false },
        particles: { show: true, color: '#FFEAA7' },
        brackets: { show: false }
      }
    },
    'indigo-crystal': {
      id: 'indigo-crystal',
      name: '藍碧クリスタル',
      desc: '藍色〜深青グラデーション・氷晶グラスグロー・知性的でシャープ',
      fontCategory: 'sans',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
      fontWeight: '800',
      fill: {
        type: 'gradient',
        angle: 120,
        stops: [
          { offset: 0, color: '#E0F2FE' },
          { offset: 0.35, color: '#38BDF8' },
          { offset: 0.7, color: '#1E3A8A' },
          { offset: 1, color: '#0F172A' }
        ]
      },
      strokes: [
        { width: 3, color: '#0F172A', blur: 0 },
        { width: 8, color: 'rgba(56, 189, 248, 0.5)', blur: 6 }
      ],
      shadow3d: {
        depth: 3,
        angle: 135,
        color: '#082F49',
        shadowBlur: 12,
        shadowColor: 'rgba(15, 23, 42, 0.45)'
      },
      glow: { enabled: true, color: 'rgba(56, 189, 248, 0.6)', blur: 21 },
      ornaments: {
        seal: { show: false },
        crown: { show: false },
        spine: { show: true, color: '#1E3A8A' },
        ribbons: { show: false },
        particles: { show: true, color: '#38BDF8' },
        brackets: { show: false }
      }
    },
    'pop-stroke': {
      id: 'pop-stroke',
      name: '多重極太フチ',
      desc: '白インナー＋黒アウター＋太字・ラノベ/同人/サムネイル向け高視認性',
      fontCategory: 'sans',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
      fontWeight: '900',
      fill: {
        type: 'gradient',
        angle: 90,
        stops: [
          { offset: 0, color: '#FF416C' },
          { offset: 0.5, color: '#FF4B2B' },
          { offset: 1, color: '#FF8008' }
        ]
      },
      strokes: [
        { width: 6, color: '#FFFFFF', blur: 0 },
        { width: 14, color: '#181818', blur: 0 }
      ],
      shadow3d: {
        depth: 5,
        angle: 135,
        color: '#111111',
        shadowBlur: 6,
        shadowColor: 'rgba(0, 0, 0, 0.5)'
      },
      glow: { enabled: false },
      ornaments: {
        seal: { show: false },
        crown: { show: false },
        spine: { show: false },
        ribbons: { show: false },
        particles: { show: true, color: '#FFD200' },
        brackets: { show: true }
      }
    },
    '3d-emboss': {
      id: '3d-emboss',
      name: '浮彫り3Dレリーフ',
      desc: '多段立体押し出し・深いアンビエントシャドウ・重厚なレリーフ',
      fontCategory: 'sans',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
      fontWeight: '900',
      fill: {
        type: 'solid',
        color: '#F5F5F5'
      },
      strokes: [
        { width: 2, color: '#D4D4D4', blur: 0 }
      ],
      shadow3d: {
        depth: 8,
        angle: 125,
        color: '#737373',
        shadowBlur: 18,
        shadowColor: 'rgba(0, 0, 0, 0.45)'
      },
      glow: { enabled: false },
      ornaments: {
        seal: { show: false },
        crown: { show: false },
        spine: { show: true, color: '#737373' },
        ribbons: { show: false },
        particles: { show: false },
        brackets: { show: false }
      }
    },
    'cyber-neon': {
      id: 'cyber-neon',
      name: '電撃ネオン',
      desc: '多層発光ブラー・サイバーシアン・暗闇に浮かび上がるエッジライト',
      fontCategory: 'sans',
      fontFamily: '"SF Mono", "Menlo", "Hiragino Sans", "Noto Sans JP", monospace',
      fontWeight: '800',
      fill: {
        type: 'solid',
        color: '#00F0FF'
      },
      strokes: [
        { width: 2, color: '#FFFFFF', blur: 0 },
        { width: 6, color: 'rgba(0, 240, 255, 0.8)', blur: 4 }
      ],
      shadow3d: {
        depth: 0,
        angle: 90,
        color: '#000000',
        shadowBlur: 0,
        shadowColor: 'transparent'
      },
      glow: { enabled: true, color: '#00F0FF', blur: 28 },
      ornaments: {
        seal: { show: false },
        crown: { show: false },
        spine: { show: true, color: '#00F0FF' },
        ribbons: { show: false },
        particles: { show: true, color: '#00F0FF' },
        brackets: { show: true }
      }
    },
    'swiss-minimal': {
      id: 'swiss-minimal',
      name: '幾何学ミニマル',
      desc: 'フィボナッチスペーシング・急所の朱の背骨線・スイススタイルの端正さ',
      fontCategory: 'sans',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
      fontWeight: '800',
      fill: {
        type: 'solid',
        color: '#181818'
      },
      strokes: [],
      shadow3d: {
        depth: 0,
        angle: 90,
        color: 'transparent',
        shadowBlur: 0,
        shadowColor: 'transparent'
      },
      glow: { enabled: false },
      ornaments: {
        seal: { show: false },
        crown: { show: false },
        spine: { show: true, color: '#D9381E' },
        ribbons: { show: false },
        particles: { show: false },
        brackets: { show: false }
      }
    },
    'ribbon-banner': {
      id: 'ribbon-banner',
      name: '伝統短冊・水引',
      desc: '和風帯封・水引オーナメント・格調ある短冊見出し',
      fontCategory: 'serif',
      fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
      fontWeight: '800',
      fill: {
        type: 'gradient',
        angle: 90,
        stops: [
          { offset: 0, color: '#FFFFFF' },
          { offset: 1, color: '#FAFAF9' }
        ]
      },
      strokes: [
        { width: 3, color: '#78350F', blur: 0 }
      ],
      shadow3d: {
        depth: 3,
        angle: 135,
        color: '#451A03',
        shadowBlur: 10,
        shadowColor: 'rgba(69, 26, 3, 0.35)'
      },
      glow: { enabled: false },
      ornaments: {
        seal: { show: true, text: '謹製', color: '#B91C1C' },
        crown: { show: false },
        spine: { show: true, color: '#B45309' },
        ribbons: { show: true, color: '#B91C1C' },
        particles: { show: false },
        brackets: { show: false }
      }
    }
  };

  /**
   * KazariEngine コアオブジェクト
   */
  const KazariEngineCore = {
    PRESETS,

    /**
     * デフォルト設定を取得
     */
    getDefaultOptions() {
      return {
        text: '天衣無縫',
        subText: 'PURE ARTISTRY & MASTER CRAFT',
        ruby: 'てんいむほう',
        badgeText: '第壱幕',
        direction: 'horizontal', // 'horizontal' | 'vertical'
        preset: 'sumi-seal',
        fontCategory: 'serif',
        fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
        fontWeight: '800',
        fontSize: 72,
        letterSpacing: 4,
        fill: {
          type: 'gradient',
          angle: 90,
          stops: [
            { offset: 0, color: '#111111' },
            { offset: 0.5, color: '#242424' },
            { offset: 1, color: '#0d0d0d' }
          ],
          solidColor: '#181818'
        },
        strokes: [
          { width: 4, color: 'rgba(255, 255, 255, 0.95)', blur: 0 },
          { width: 9, color: 'rgba(24, 24, 24, 0.45)', blur: 4 }
        ],
        shadow3d: {
          depth: 2,
          angle: 135,
          color: 'rgba(0, 0, 0, 0.25)',
          shadowBlur: 8,
          shadowColor: 'rgba(0, 0, 0, 0.35)'
        },
        glow: {
          enabled: false,
          color: 'rgba(217, 56, 30, 0.6)',
          blur: 16
        },
        ornaments: {
          seal: { show: true, text: '極', color: '#D9381E' },
          crown: { show: false, color: '#DFB15B' },
          spine: { show: true, color: '#D9381E' },
          ribbons: { show: false, color: '#B91C1C' },
          particles: { show: false, color: '#FFEAA7' },
          brackets: { show: false }
        },
        padding: 40,
        backgroundColor: 'transparent'
      };
    },

    /**
     * プリセットをマージしたオプションを生成
     */
    resolveOptions(userOpts = {}) {
      const def = this.getDefaultOptions();
      const presetKey = userOpts.preset || def.preset;
      const presetData = PRESETS[presetKey] || PRESETS['sumi-seal'];

      const merged = {
        ...def,
        ...presetData,
        ...userOpts,
        fill: {
          ...def.fill,
          ...(presetData.fill || {}),
          ...(userOpts.fill || {})
        },
        shadow3d: {
          ...def.shadow3d,
          ...(presetData.shadow3d || {}),
          ...(userOpts.shadow3d || {})
        },
        glow: {
          ...def.glow,
          ...(presetData.glow || {}),
          ...(userOpts.glow || {})
        },
        ornaments: {
          ...def.ornaments,
          ...(presetData.ornaments || {}),
          ...(userOpts.ornaments || {})
        }
      };

      if (userOpts.strokes) {
        merged.strokes = userOpts.strokes;
      } else if (presetData.strokes) {
        merged.strokes = JSON.parse(JSON.stringify(presetData.strokes));
      }

      return merged;
    },

    /**
     * 縦書き用に文字を置換・解析
     */
    transformGlyphsForVertical(text) {
      const chars = Array.from(text || '');
      return chars.map((char) => {
        const mapped = VERTICAL_GLYPH_MAP[char];
        const isSmall = SMALL_KANA_SET.has(char);
        return {
          original: char,
          glyph: mapped || char,
          isSpecialMapped: !!mapped,
          isSmall
        };
      });
    },

    /**
     * Canvas 描画寸法とレイアウトを計算
     */
    measureLayout(ctx, opts, scale = 1) {
      const isVertical = opts.direction === 'vertical';
      const mainFontSize = (opts.fontSize || 72) * scale;
      const letterSpacing = (opts.letterSpacing || 4) * scale;
      const rubyFontSize = Math.max(12 * scale, Math.round(mainFontSize * 0.28));
      const subFontSize = Math.max(13 * scale, Math.round(mainFontSize * 0.24));
      const badgeFontSize = Math.max(12 * scale, Math.round(mainFontSize * 0.22));

      ctx.save();
      ctx.font = `${opts.fontWeight || '800'} ${mainFontSize}px ${opts.fontFamily}`;

      const text = opts.text || '';
      let textWidth = 0;
      let textHeight = 0;

      if (!isVertical) {
        // 横書きメトリクス
        const metrics = ctx.measureText(text);
        textWidth = metrics.width + (text.length > 1 ? (text.length - 1) * letterSpacing : 0);
        textHeight = mainFontSize;
      } else {
        // 縦書きメトリクス
        const glyphs = this.transformGlyphsForVertical(text);
        let maxWidth = 0;
        glyphs.forEach((g) => {
          const m = ctx.measureText(g.glyph);
          if (m.width > maxWidth) maxWidth = m.width;
        });
        textWidth = Math.max(mainFontSize, maxWidth);
        textHeight = glyphs.length * (mainFontSize + letterSpacing) - (glyphs.length > 0 ? letterSpacing : 0);
      }

      // ルビ・サブタイトル・バッジの寸法計算
      let rubyWidth = 0;
      let rubyHeight = 0;
      if (opts.ruby) {
        ctx.font = `600 ${rubyFontSize}px ${opts.fontFamily}`;
        const rm = ctx.measureText(opts.ruby);
        rubyWidth = rm.width;
        rubyHeight = rubyFontSize;
      }

      let subWidth = 0;
      let subHeight = 0;
      if (opts.subText) {
        ctx.font = `600 ${subFontSize}px "SF Mono", "Inter", sans-serif`;
        const sm = ctx.measureText(opts.subText);
        subWidth = sm.width + (opts.subText.length > 1 ? (opts.subText.length - 1) * (2 * scale) : 0);
        subHeight = subFontSize;
      }

      let badgeWidth = 0;
      let badgeHeight = 0;
      if (opts.badgeText) {
        ctx.font = `700 ${badgeFontSize}px ${opts.fontFamily}`;
        const bm = ctx.measureText(opts.badgeText);
        badgeWidth = bm.width + 16 * scale;
        badgeHeight = badgeFontSize + 8 * scale;
      }

      // 落款（朱印）寸法
      const sealSize = opts.ornaments?.seal?.show ? Math.max(28 * scale, mainFontSize * 0.45) : 0;

      // 3D押し出し・ストローク・グローの最大パディング量
      let maxStrokeWidth = 0;
      (opts.strokes || []).forEach((s) => {
        if ((s.width || 0) * scale > maxStrokeWidth) {
          maxStrokeWidth = (s.width || 0) * scale;
        }
      });
      const depth3d = (opts.shadow3d?.depth || 0) * scale;
      const glowBlur = (opts.glow?.enabled ? (opts.glow?.blur || 0) : 0) * scale;
      const extraMargin = Math.max(maxStrokeWidth * 2, depth3d * 2, glowBlur) + (opts.padding || 40) * scale;

      let totalWidth = 0;
      let totalHeight = 0;

      if (!isVertical) {
        // 横書き配置計算
        const contentWidth = Math.max(textWidth, subWidth) + (sealSize > 0 ? sealSize + 16 * scale : 0) + (badgeWidth > 0 ? badgeWidth + 12 * scale : 0);
        const contentHeight = textHeight + (opts.ruby ? rubyHeight + 8 * scale : 0) + (opts.subText ? subHeight + 12 * scale : 0) + (opts.ornaments?.crown?.show ? 30 * scale : 0);
        totalWidth = Math.ceil(contentWidth + extraMargin * 2);
        totalHeight = Math.ceil(contentHeight + extraMargin * 2);
      } else {
        // 縦書き配置計算
        const contentWidth = textWidth + (opts.ruby ? rubyWidth + 12 * scale : 0) + (opts.subText ? subHeight + 16 * scale : 0) + (sealSize > 0 ? 12 * scale : 0);
        const contentHeight = Math.max(textHeight, subWidth) + (sealSize > 0 ? sealSize + 16 * scale : 0) + (badgeHeight > 0 ? badgeHeight + 12 * scale : 0);
        totalWidth = Math.ceil(contentWidth + extraMargin * 2);
        totalHeight = Math.ceil(contentHeight + extraMargin * 2);
      }

      ctx.restore();

      return {
        totalWidth: Math.max(120 * scale, totalWidth),
        totalHeight: Math.max(80 * scale, totalHeight),
        mainFontSize,
        letterSpacing,
        rubyFontSize,
        subFontSize,
        badgeFontSize,
        textWidth,
        textHeight,
        rubyWidth,
        rubyHeight,
        subWidth,
        subHeight,
        badgeWidth,
        badgeHeight,
        sealSize,
        extraMargin,
        isVertical
      };
    },

    /**
     * グラデーションまたは単色塗り用の Canvas スタイルを生成
     */
    createFillStyle(ctx, fillConfig, x, y, width, height) {
      if (!fillConfig) return '#181818';
      if (fillConfig.type === 'solid' || !fillConfig.stops || fillConfig.stops.length === 0) {
        return fillConfig.color || fillConfig.solidColor || '#181818';
      }

      const angleRad = ((fillConfig.angle || 90) * Math.PI) / 180;
      const cx = x + width / 2;
      const cy = y + height / 2;
      const length = Math.sqrt(width * width + height * height) / 2;

      const x0 = cx - Math.cos(angleRad) * length;
      const y0 = cy - Math.sin(angleRad) * length;
      const x1 = cx + Math.cos(angleRad) * length;
      const y1 = cy + Math.sin(angleRad) * length;

      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      fillConfig.stops.forEach((stop) => {
        grad.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
      });
      return grad;
    },

    /**
     * Canvas 上に飾り文字全体をレンダリング
     */
    renderCanvas(canvas, userOpts = {}, scale = 1) {
      const opts = this.resolveOptions(userOpts);
      const ctx = canvas.getContext('2d');
      const layout = this.measureLayout(ctx, opts, scale);

      canvas.width = layout.totalWidth;
      canvas.height = layout.totalHeight;

      // 背景のクリア
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (opts.backgroundColor && opts.backgroundColor !== 'transparent') {
        ctx.fillStyle = opts.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // レンダリング基準座標の算出
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      ctx.save();

      // 1. パーティクル・星屑オーナメント
      if (opts.ornaments?.particles?.show) {
        this.drawParticles(ctx, centerX, centerY, layout, opts, scale);
      }

      // 2. 背骨線 (Spine Line)
      if (opts.ornaments?.spine?.show) {
        this.drawSpineLine(ctx, centerX, centerY, layout, opts, scale);
      }

      // 3. 王冠 (Crown)
      if (opts.ornaments?.crown?.show) {
        this.drawCrown(ctx, centerX, centerY, layout, opts, scale);
      }

      // 4. 水引・リボン (Ribbons)
      if (opts.ornaments?.ribbons?.show) {
        this.drawRibbons(ctx, centerX, centerY, layout, opts, scale);
      }

      // 5. バッジ（章番号・プレフィックス）
      if (opts.badgeText) {
        this.drawBadge(ctx, centerX, centerY, layout, opts, scale);
      }

      // 6. メインタイポグラフィ描画
      this.drawMainTypography(ctx, centerX, centerY, layout, opts, scale);

      // 7. ルビ（ふりがな）描画
      if (opts.ruby) {
        this.drawRuby(ctx, centerX, centerY, layout, opts, scale);
      }

      // 8. サブテキスト / 欧文キャッチ描画
      if (opts.subText) {
        this.drawSubText(ctx, centerX, centerY, layout, opts, scale);
      }

      // 9. 落款（朱印）描画
      if (opts.ornaments?.seal?.show && opts.ornaments?.seal?.text) {
        this.drawSeal(ctx, centerX, centerY, layout, opts, scale);
      }

      ctx.restore();
      return canvas;
    },

    /**
     * メインタイポグラフィの描画（3D押し出し、多重ストローク、塗り）
     */
    drawMainTypography(ctx, cx, cy, layout, opts, scale) {
      const isVertical = layout.isVertical;
      const text = opts.text || '';
      const mainFontSize = layout.mainFontSize;
      const letterSpacing = layout.letterSpacing;
      const strokes = (opts.strokes || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0));
      const shadow3d = opts.shadow3d || {};
      const glow = opts.glow || {};

      ctx.save();
      ctx.font = `${opts.fontWeight || '800'} ${mainFontSize}px ${opts.fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      // 基準描画位置
      let startX = cx;
      let startY = cy;

      if (!isVertical) {
        // 横書きのオフセット調整（ルビやサブテキストの存在に応じたバランス）
        if (opts.ruby && !opts.subText) startY += layout.rubyHeight * 0.4;
        if (opts.subText && !opts.ruby) startY -= layout.subHeight * 0.4;
      }

      // 描画実行クロージャ
      const renderTextPath = (offsetX = 0, offsetY = 0, strokeConf = null, isFill = false, customFillStyle = null) => {
        if (!isVertical) {
          // 横書き
          const totalW = layout.textWidth;
          let curX = startX - totalW / 2 + mainFontSize * 0.48;
          const chars = Array.from(text);

          chars.forEach((ch, idx) => {
            const charMetrics = ctx.measureText(ch);
            const posX = curX + offsetX;
            const posY = startY + offsetY;

            if (strokeConf) {
              ctx.lineWidth = strokeConf.width * scale * 2;
              ctx.strokeStyle = strokeConf.color;
              ctx.lineJoin = 'round';
              ctx.lineCap = 'round';
              if (strokeConf.blur > 0) {
                ctx.shadowColor = strokeConf.color;
                ctx.shadowBlur = strokeConf.blur * scale;
              } else {
                ctx.shadowBlur = 0;
              }
              ctx.strokeText(ch, posX, posY);
            }

            if (isFill) {
              ctx.fillStyle = customFillStyle;
              ctx.shadowBlur = 0;
              ctx.fillText(ch, posX, posY);
            }

            curX += charMetrics.width + letterSpacing;
          });
        } else {
          // 縦書き
          const glyphs = this.transformGlyphsForVertical(text);
          const totalH = layout.textHeight;
          let curY = startY - totalH / 2 + mainFontSize * 0.5;

          glyphs.forEach((g) => {
            let posX = startX + offsetX;
            let posY = curY + offsetY;

            // 促音・句読点の右上オフセット
            if (g.isSmall) {
              posX += mainFontSize * 0.15;
              posY -= mainFontSize * 0.12;
            }

            if (strokeConf) {
              ctx.lineWidth = strokeConf.width * scale * 2;
              ctx.strokeStyle = strokeConf.color;
              ctx.lineJoin = 'round';
              ctx.lineCap = 'round';
              if (strokeConf.blur > 0) {
                ctx.shadowColor = strokeConf.color;
                ctx.shadowBlur = strokeConf.blur * scale;
              } else {
                ctx.shadowBlur = 0;
              }
              ctx.strokeText(g.glyph, posX, posY);
            }

            if (isFill) {
              ctx.fillStyle = customFillStyle;
              ctx.shadowBlur = 0;
              ctx.fillText(g.glyph, posX, posY);
            }

            curY += mainFontSize + letterSpacing;
          });
        }
      };

      // A. ネオン／発光グロー (Glow Effect)
      if (glow.enabled && glow.blur > 0) {
        ctx.save();
        ctx.shadowColor = glow.color || '#00F0FF';
        ctx.shadowBlur = glow.blur * scale;
        renderTextPath(0, 0, null, true, glow.color || '#00F0FF');
        ctx.restore();
      }

      // B. 3D押し出し立体感 (3D Extrusion)
      const depth = (shadow3d.depth || 0) * scale;
      if (depth > 0) {
        const rad = ((shadow3d.angle || 135) * Math.PI) / 180;
        const dx = Math.cos(rad);
        const dy = Math.sin(rad);

        // ドロップシャドウ
        if (shadow3d.shadowBlur > 0) {
          ctx.save();
          ctx.shadowColor = shadow3d.shadowColor || 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = shadow3d.shadowBlur * scale;
          renderTextPath(dx * depth * 1.5, dy * depth * 1.5, null, true, shadow3d.color || '#181818');
          ctx.restore();
        }

        // 多段レイヤースタック
        const steps = Math.max(3, Math.round(depth));
        for (let s = steps; s >= 1; s--) {
          const ratio = s / steps;
          const ox = dx * depth * ratio;
          const oy = dy * depth * ratio;
          renderTextPath(ox, oy, null, true, shadow3d.color || '#333333');
        }
      }

      // C. 多重フチ取り (Multi Stroke: 外フチから内フチの順)
      strokes.forEach((strokeConf) => {
        ctx.save();
        renderTextPath(0, 0, strokeConf, false);
        ctx.restore();
      });

      // D. メイン塗り (Fill)
      const fillStyle = this.createFillStyle(
        ctx,
        opts.fill,
        startX - layout.textWidth / 2,
        startY - layout.textHeight / 2,
        layout.textWidth,
        layout.textHeight
      );
      renderTextPath(0, 0, null, true, fillStyle);

      // E. 括弧オーナメント（【 】）
      if (opts.ornaments?.brackets) {
        this.drawBrackets(ctx, startX, startY, layout, opts, scale);
      }

      ctx.restore();
    },

    /**
     * ルビ（ふりがな）描画
     */
    drawRuby(ctx, cx, cy, layout, opts, scale) {
      const rubyText = opts.ruby || '';
      if (!rubyText) return;

      const rubyFontSize = layout.rubyFontSize;
      const isVertical = layout.isVertical;

      ctx.save();
      ctx.font = `600 ${rubyFontSize}px ${opts.fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = opts.fill?.solidColor || (opts.preset === 'cyber-neon' ? '#00F0FF' : '#4A4A4A');

      if (!isVertical) {
        // 横書き: メインテキストの上部に均等配置
        const posY = cy - layout.textHeight / 2 - rubyFontSize * 0.7;
        const mainW = layout.textWidth;
        const rubyChars = Array.from(rubyText);

        if (rubyChars.length === 1) {
          ctx.fillText(rubyText, cx, posY);
        } else {
          const step = mainW / rubyChars.length;
          let curX = cx - mainW / 2 + step / 2;
          rubyChars.forEach((ch) => {
            ctx.fillText(ch, curX, posY);
            curX += step;
          });
        }
      } else {
        // 縦書き: メインテキストの右側に配置
        const posX = cx + layout.textWidth / 2 + rubyFontSize * 0.7;
        const glyphs = this.transformGlyphsForVertical(rubyText);
        const totalH = layout.textHeight;
        const step = totalH / glyphs.length;
        let curY = cy - totalH / 2 + step / 2;

        glyphs.forEach((g) => {
          ctx.fillText(g.glyph, posX, curY);
          curY += step;
        });
      }

      ctx.restore();
    },

    /**
     * サブテキスト / 欧文キャッチ描画
     */
    drawSubText(ctx, cx, cy, layout, opts, scale) {
      const subText = opts.subText || '';
      if (!subText) return;

      const subFontSize = layout.subFontSize;
      const isVertical = layout.isVertical;

      ctx.save();
      ctx.font = `600 ${subFontSize}px "SF Mono", "Inter", "Hiragino Sans", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = opts.preset === 'cyber-neon' ? '#00F0FF' : (opts.preset === 'gold-brass' ? '#DFB15B' : '#64748B');

      if (!isVertical) {
        // 横書き: メインテキストの下部に配置
        const posY = cy + layout.textHeight / 2 + subFontSize * 1.3;
        const chars = Array.from(subText);
        const letterSpacing = 2 * scale;
        const totalW = layout.subWidth;
        let curX = cx - totalW / 2 + subFontSize * 0.3;

        chars.forEach((ch) => {
          const m = ctx.measureText(ch);
          ctx.fillText(ch, curX, posY);
          curX += m.width + letterSpacing;
        });
      } else {
        // 縦書き: メインテキストの左側に配置
        const posX = cx - layout.textWidth / 2 - subFontSize * 1.2;
        ctx.save();
        ctx.translate(posX, cy);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.fillText(subText, 0, 0);
        ctx.restore();
      }

      ctx.restore();
    },

    /**
     * バッジ（章番号・プレフィックス）描画
     */
    drawBadge(ctx, cx, cy, layout, opts, scale) {
      const badgeText = opts.badgeText || '';
      if (!badgeText) return;

      ctx.save();
      const badgeFontSize = layout.badgeFontSize;
      ctx.font = `700 ${badgeFontSize}px ${opts.fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      const isVertical = layout.isVertical;
      let posX = cx;
      let posY = cy;

      if (!isVertical) {
        posX = cx - layout.textWidth / 2 - layout.badgeWidth / 2 - 8 * scale;
        posY = cy;
      } else {
        posX = cx;
        posY = cy - layout.textHeight / 2 - layout.badgeHeight / 2 - 8 * scale;
      }

      // バッジの背景ピル
      const bw = layout.badgeWidth;
      const bh = layout.badgeHeight;
      const radius = 4 * scale;
      const accentColor = opts.ornaments?.seal?.color || '#D9381E';

      ctx.fillStyle = opts.preset === 'cyber-neon' ? 'rgba(0, 240, 255, 0.15)' : 'rgba(0, 0, 0, 0.06)';
      ctx.beginPath();
      ctx.roundRect(posX - bw / 2, posY - bh / 2, bw, bh, radius);
      ctx.fill();

      // バッジ枠線
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1 * scale;
      ctx.stroke();

      // テキスト
      ctx.fillStyle = accentColor;
      ctx.fillText(badgeText, posX, posY);

      ctx.restore();
    },

    /**
     * 落款（朱印・角印）描画
     */
    drawSeal(ctx, cx, cy, layout, opts, scale) {
      const sealConf = opts.ornaments?.seal;
      if (!sealConf?.show || !sealConf?.text) return;

      const sealSize = layout.sealSize;
      const isVertical = layout.isVertical;
      let sx = cx;
      let sy = cy;

      if (!isVertical) {
        // 横書き: タイトルの右端下に配置
        sx = cx + layout.textWidth / 2 + sealSize * 0.7;
        sy = cy + layout.textHeight * 0.1;
      } else {
        // 縦書き: タイトルの末尾下に配置
        sx = cx;
        sy = cy + layout.textHeight / 2 + sealSize * 0.7;
      }

      ctx.save();
      const sealColor = sealConf.color || '#D9381E';
      const half = sealSize / 2;
      const rad = 3 * scale;

      // 朱印の枠（二重線）
      ctx.fillStyle = sealColor;
      ctx.beginPath();
      ctx.roundRect(sx - half, sy - half, sealSize, sealSize, rad);
      ctx.fill();

      // 内側の余白抜き
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(sx - half + 2 * scale, sy - half + 2 * scale, sealSize - 4 * scale, sealSize - 4 * scale, rad * 0.8);
      ctx.fill();

      // 朱の文字背景
      ctx.fillStyle = sealColor;
      ctx.beginPath();
      ctx.roundRect(sx - half + 3.5 * scale, sy - half + 3.5 * scale, sealSize - 7 * scale, sealSize - 7 * scale, rad * 0.6);
      ctx.fill();

      // 白抜きの印文字
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `900 ${Math.round(sealSize * 0.55)}px "Hiragino Mincho ProN", "Yu Mincho", serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(sealConf.text.slice(0, 2), sx, sy);

      ctx.restore();
    },

    /**
     * 背骨線（Spine Line）描画
     */
    drawSpineLine(ctx, cx, cy, layout, opts, scale) {
      const color = opts.ornaments?.spine?.color || '#D9381E';
      const isVertical = layout.isVertical;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();

      if (!isVertical) {
        // 横書き: タイトルの左端に静かな縦のアクセントバー
        const lineX = cx - layout.textWidth / 2 - 12 * scale;
        const lineY1 = cy - layout.textHeight / 2;
        const lineY2 = cy + layout.textHeight / 2;
        ctx.moveTo(lineX, lineY1);
        ctx.lineTo(lineX, lineY2);
      } else {
        // 縦書き: タイトルの上端に静かな横アクセントバー
        const lineY = cy - layout.textHeight / 2 - 12 * scale;
        const lineX1 = cx - layout.textWidth / 2;
        const lineX2 = cx + layout.textWidth / 2;
        ctx.moveTo(lineX1, lineY);
        ctx.lineTo(lineX2, lineY);
      }

      ctx.stroke();
      ctx.restore();
    },

    /**
     * 王冠（Crown）オーナメント描画
     */
    drawCrown(ctx, cx, cy, layout, opts, scale) {
      const color = opts.ornaments?.crown?.color || '#DFB15B';
      const crownW = 34 * scale;
      const crownH = 18 * scale;
      const crownY = cy - layout.textHeight / 2 - crownH - 6 * scale;

      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#5A4010';
      ctx.lineWidth = 1 * scale;

      ctx.beginPath();
      ctx.moveTo(cx - crownW / 2, crownY + crownH);
      ctx.lineTo(cx - crownW / 2, crownY + crownH * 0.3);
      ctx.lineTo(cx - crownW * 0.25, crownY + crownH * 0.6);
      ctx.lineTo(cx, crownY);
      ctx.lineTo(cx + crownW * 0.25, crownY + crownH * 0.6);
      ctx.lineTo(cx + crownW / 2, crownY + crownH * 0.3);
      ctx.lineTo(cx + crownW / 2, crownY + crownH);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 王冠の先端の宝石ドット
      const dots = [-crownW / 2, 0, crownW / 2];
      ctx.fillStyle = '#FFF8E7';
      dots.forEach((dx, i) => {
        const dy = i === 1 ? crownY : crownY + crownH * 0.3;
        ctx.beginPath();
        ctx.arc(cx + dx, dy, 2.5 * scale, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    },

    /**
     * 水引・リボン描画
     */
    drawRibbons(ctx, cx, cy, layout, opts, scale) {
      const color = opts.ornaments?.ribbons?.color || '#B91C1C';
      const w = layout.textWidth + 40 * scale;
      const h = layout.textHeight + 16 * scale;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * scale;

      // 短冊枠（二重線）
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2 - 3 * scale, cy - h / 2 - 3 * scale, w + 6 * scale, h + 6 * scale);

      ctx.restore();
    },

    /**
     * パーティクル・星屑描画
     */
    drawParticles(ctx, cx, cy, layout, opts, scale) {
      const color = opts.ornaments?.particles?.color || '#FFEAA7';
      const points = [
        { x: cx - layout.textWidth * 0.55, y: cy - layout.textHeight * 0.45, r: 4 * scale },
        { x: cx + layout.textWidth * 0.52, y: cy - layout.textHeight * 0.4, r: 3 * scale },
        { x: cx - layout.textWidth * 0.48, y: cy + layout.textHeight * 0.48, r: 2.5 * scale },
        { x: cx + layout.textWidth * 0.56, y: cy + layout.textHeight * 0.35, r: 3.5 * scale }
      ];

      ctx.save();
      ctx.fillStyle = color;

      points.forEach((pt) => {
        // 4芒星の描画
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - pt.r * 2);
        ctx.quadraticCurveTo(pt.x, pt.y, pt.x + pt.r * 2, pt.y);
        ctx.quadraticCurveTo(pt.x, pt.y, pt.x, pt.y + pt.r * 2);
        ctx.quadraticCurveTo(pt.x, pt.y, pt.x - pt.r * 2, pt.y);
        ctx.quadraticCurveTo(pt.x, pt.y, pt.x, pt.y - pt.r * 2);
        ctx.closePath();
        ctx.fill();
      });

      ctx.restore();
    },

    /**
     * 括弧飾り（【 】）描画
     */
    drawBrackets(ctx, cx, cy, layout, opts, scale) {
      ctx.save();
      ctx.fillStyle = opts.ornaments?.seal?.color || '#D9381E';
      ctx.font = `900 ${layout.mainFontSize}px ${opts.fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      if (!layout.isVertical) {
        ctx.fillText('【', cx - layout.textWidth / 2 - layout.mainFontSize * 0.25, cy);
        ctx.fillText('】', cx + layout.textWidth / 2 + layout.mainFontSize * 0.25, cy);
      }

      ctx.restore();
    },

    /**
     * ベクター SVG コード生成（拡大無劣化）
     */
    generateSVG(userOpts = {}) {
      const opts = this.resolveOptions(userOpts);
      // レイアウト測定用の仮想 Canvas
      let canvas;
      if (typeof document !== 'undefined') {
        canvas = document.createElement('canvas');
      } else {
        // Node.js テスト環境用の擬似メトリクス
        canvas = {
          getContext: () => ({
            save: () => {},
            restore: () => {},
            measureText: (t) => ({ width: t.length * (opts.fontSize || 72) * 0.9 })
          })
        };
      }
      const ctx = canvas.getContext('2d');
      const layout = this.measureLayout(ctx, opts, 1);

      const w = layout.totalWidth;
      const h = layout.totalHeight;
      const cx = w / 2;
      const cy = h / 2;
      const isVertical = layout.isVertical;
      const text = opts.text || '';
      const mainFontSize = layout.mainFontSize;
      const letterSpacing = layout.letterSpacing;

      let defs = '';
      let filterId = '';
      let gradientId = 'kazari-grad-' + Math.random().toString(36).substr(2, 6);

      // SVG グラデーション定義
      if (opts.fill?.type === 'gradient' && opts.fill?.stops) {
        const stopsXml = opts.fill.stops
          .map((s) => `<stop offset="${(s.offset * 100).toFixed(0)}%" stop-color="${s.color}" />`)
          .join('');
        defs += `<linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">${stopsXml}</linearGradient>`;
      }

      // SVG グロー・フィルター定義
      if (opts.glow?.enabled) {
        filterId = 'kazari-glow-' + Math.random().toString(36).substr(2, 6);
        defs += `
        <filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="${opts.glow.blur / 2}" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>`;
      }

      const fillRef = opts.fill?.type === 'gradient' ? `url(#${gradientId})` : (opts.fill?.solidColor || opts.fill?.color || '#181818');
      const filterRef = filterId ? `filter="url(#${filterId})"` : '';

      let contentXml = '';

      // 背骨線
      if (opts.ornaments?.spine?.show) {
        const color = opts.ornaments?.spine?.color || '#D9381E';
        if (!isVertical) {
          const lx = cx - layout.textWidth / 2 - 12;
          contentXml += `<line x1="${lx}" y1="${cy - layout.textHeight / 2}" x2="${lx}" y2="${cy + layout.textHeight / 2}" stroke="${color}" stroke-width="2" />`;
        } else {
          const ly = cy - layout.textHeight / 2 - 12;
          contentXml += `<line x1="${cx - layout.textWidth / 2}" y1="${ly}" x2="${cx + layout.textWidth / 2}" y2="${ly}" stroke="${color}" stroke-width="2" />`;
        }
      }

      // メインテキスト要素生成
      const strokes = (opts.strokes || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0));

      if (!isVertical) {
        // 横書きテキスト
        strokes.forEach((st) => {
          contentXml += `
          <text x="${cx}" y="${cy}" font-family='${opts.fontFamily}' font-size="${mainFontSize}" font-weight="${opts.fontWeight}" text-anchor="middle" dominant-baseline="central" letter-spacing="${letterSpacing}" fill="none" stroke="${st.color}" stroke-width="${st.width * 2}" stroke-linejoin="round">${this.escapeXml(text)}</text>`;
        });

        contentXml += `
        <text x="${cx}" y="${cy}" font-family='${opts.fontFamily}' font-size="${mainFontSize}" font-weight="${opts.fontWeight}" text-anchor="middle" dominant-baseline="central" letter-spacing="${letterSpacing}" fill="${fillRef}" ${filterRef}>${this.escapeXml(text)}</text>`;
      } else {
        // 縦書きテキスト
        const glyphs = this.transformGlyphsForVertical(text);
        let curY = cy - layout.textHeight / 2 + mainFontSize * 0.5;

        glyphs.forEach((g) => {
          let posX = cx;
          let posY = curY;
          if (g.isSmall) {
            posX += mainFontSize * 0.15;
            posY -= mainFontSize * 0.12;
          }

          strokes.forEach((st) => {
            contentXml += `
            <text x="${posX}" y="${posY}" font-family='${opts.fontFamily}' font-size="${mainFontSize}" font-weight="${opts.fontWeight}" text-anchor="middle" dominant-baseline="central" fill="none" stroke="${st.color}" stroke-width="${st.width * 2}" stroke-linejoin="round">${this.escapeXml(g.glyph)}</text>`;
          });

          contentXml += `
          <text x="${posX}" y="${posY}" font-family='${opts.fontFamily}' font-size="${mainFontSize}" font-weight="${opts.fontWeight}" text-anchor="middle" dominant-baseline="central" fill="${fillRef}" ${filterRef}>${this.escapeXml(g.glyph)}</text>`;

          curY += mainFontSize + letterSpacing;
        });
      }

      // ルビ
      if (opts.ruby) {
        const rubyFontSize = layout.rubyFontSize;
        const rubyY = !isVertical ? cy - layout.textHeight / 2 - rubyFontSize * 0.7 : cy;
        const rubyX = !isVertical ? cx : cx + layout.textWidth / 2 + rubyFontSize * 0.7;
        contentXml += `
        <text x="${rubyX}" y="${rubyY}" font-family='${opts.fontFamily}' font-size="${rubyFontSize}" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="#4A4A4A">${this.escapeXml(opts.ruby)}</text>`;
      }

      // サブテキスト
      if (opts.subText) {
        const subFontSize = layout.subFontSize;
        const subY = cy + layout.textHeight / 2 + subFontSize * 1.3;
        contentXml += `
        <text x="${cx}" y="${subY}" font-family='"SF Mono", monospace' font-size="${subFontSize}" font-weight="600" text-anchor="middle" dominant-baseline="central" letter-spacing="2" fill="#64748B">${this.escapeXml(opts.subText)}</text>`;
      }

      // 落款（朱印）
      if (opts.ornaments?.seal?.show && opts.ornaments?.seal?.text) {
        const sealSize = layout.sealSize;
        const sx = !isVertical ? cx + layout.textWidth / 2 + sealSize * 0.7 : cx;
        const sy = !isVertical ? cy + layout.textHeight * 0.1 : cy + layout.textHeight / 2 + sealSize * 0.7;
        const sealColor = opts.ornaments?.seal?.color || '#D9381E';

        contentXml += `
        <g transform="translate(${sx - sealSize / 2}, ${sy - sealSize / 2})">
          <rect width="${sealSize}" height="${sealSize}" rx="3" fill="${sealColor}" />
          <rect x="2" y="2" width="${sealSize - 4}" height="${sealSize - 4}" rx="2" fill="#FFF" />
          <rect x="3.5" y="3.5" width="${sealSize - 7}" height="${sealSize - 7}" rx="1.5" fill="${sealColor}" />
          <text x="${sealSize / 2}" y="${sealSize / 2}" font-family='"Hiragino Mincho ProN", serif' font-size="${sealSize * 0.55}" font-weight="900" text-anchor="middle" dominant-baseline="central" fill="#FFF">${this.escapeXml(opts.ornaments.seal.text.slice(0, 2))}</text>
        </g>`;
      }

      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>${defs}
  </defs>
  ${contentXml}
</svg>`;
    },

    /**
     * Web コピペ用 CSS スニペット生成
     */
    generateCSS(userOpts = {}) {
      const opts = this.resolveOptions(userOpts);
      const shadows = [];

      // 3D押し出しシャドウ
      if (opts.shadow3d?.depth > 0) {
        const depth = opts.shadow3d.depth;
        const color = opts.shadow3d.color || '#333333';
        for (let i = 1; i <= depth; i++) {
          shadows.push(`${i}px ${i}px 0 ${color}`);
        }
        if (opts.shadow3d.shadowBlur > 0) {
          shadows.push(`${depth + 2}px ${depth + 2}px ${opts.shadow3d.shadowBlur}px ${opts.shadow3d.shadowColor || 'rgba(0,0,0,0.4)'}`);
        }
      }

      // 光彩
      if (opts.glow?.enabled && opts.glow?.blur > 0) {
        shadows.push(`0 0 ${opts.glow.blur}px ${opts.glow.color || '#00F0FF'}`);
      }

      const stroke = opts.strokes?.[0];
      const strokeCss = stroke ? `-webkit-text-stroke: ${stroke.width}px ${stroke.color};` : '';
      const shadowCss = shadows.length > 0 ? `text-shadow: ${shadows.join(',\n    ')};` : '';

      let colorCss = `color: ${opts.fill?.solidColor || '#181818'};`;
      if (opts.fill?.type === 'gradient' && opts.fill?.stops) {
        const stops = opts.fill.stops.map((s) => `${s.color} ${(s.offset * 100).toFixed(0)}%`).join(', ');
        colorCss = `background: linear-gradient(${opts.fill.angle || 90}deg, ${stops});
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;`;
      }

      return `.kazari-title {
  font-family: ${opts.fontFamily};
  font-size: ${opts.fontSize || 72}px;
  font-weight: ${opts.fontWeight || 800};
  letter-spacing: ${opts.letterSpacing || 4}px;
  line-height: 1.2;
  ${colorCss}
  ${strokeCss}
  ${shadowCss}
  ${opts.direction === 'vertical' ? 'writing-mode: vertical-rl;' : ''}
}`;
    },

    /**
     * Unicode 特殊文字 / 罫線付き装飾テキスト生成
     */
    generateUnicodeFancy(text, style = 'bold-serif') {
      const MAPS = {
        'bold-serif': {
          a: '𝐚', b: '𝐛', c: '𝐜', d: '𝐝', e: '𝐞', f: '𝐟', g: '𝐠', h: '𝐡', i: '𝐢', j: '𝐣', k: '𝐤', l: '𝐥', m: '𝐦',
          n: '𝐧', o: '𝐨', p: '𝐩', q: '𝐪', r: '𝐫', s: '𝐬', t: '𝐭', u: '𝐮', v: '𝐯', w: '𝐰', x: '𝐱', y: '𝐲', z: '𝐳',
          A: '𝐀', B: '𝐁', C: '𝐂', D: '𝐃', E: '𝐄', F: '𝐅', G: '𝐆', H: '𝐇', I: '𝐈', J: '𝐉', K: '𝐊', L: '𝐋', M: '𝐌',
          N: '𝐍', O: '𝐎', P: '𝐏', Q: '𝐐', R: '𝐑', S: '𝐒', T: '𝐓', U: '𝐔', V: '𝐕', W: '𝐖', X: '𝐗', Y: '𝐘', Z: '𝐙',
          0: '𝟎', 1: '𝟏', 2: '𝟐', 3: '𝟑', 4: '𝟒', 5: '𝟓', 6: '𝟔', 7: '𝟕', 8: '𝟖', 9: '𝟗'
        },
        'fraktur': {
          a: '𝖆', b: '𝖇', c: '𝖈', d: '𝖉', e: '𝖊', f: '𝖋', g: '𝖌', h: '𝖍', i: '𝖎', j: '𝖏', k: '𝖐', l: '𝖑', m: '𝖒',
          n: '𝖓', o: '𝖔', p: '𝖕', q: '𝖖', r: '𝖗', s: '𝖘', t: '𝖙', u: '𝖚', v: '𝖛', w: '𝖜', x: '𝖝', y: '𝖞', z: '𝖟',
          A: '𝕬', B: '𝕭', C: '𝕮', D: '𝕯', E: '𝕰', F: '𝕱', G: '𝕲', H: '𝕳', I: '𝕴', J: '𝕵', K: '𝕶', L: '𝕷', M: '𝕸',
          N: '𝕹', O: '𝕺', P: '𝕻', Q: '𝕼', R: '𝕽', S: '𝕾', T: '𝕿', U: '𝖀', V: '𝖁', W: '𝖂', X: '𝖃', Y: '𝖄', Z: '𝖅'
        },
        'double-struck': {
          a: '𝕒', b: '𝕓', c: '𝕔', d: '𝕕', e: '𝕖', f: '𝕗', g: '𝕘', h: '𝕙', i: '𝕚', j: '𝕛', k: '𝕜', l: '𝕝', m: '𝕞',
          n: '𝕟', o: '𝕠', p: '𝕡', q: '𝕢', r: '𝕣', s: '𝕤', t: '𝕥', u: '𝕦', v: '𝕧', w: '𝕨', x: '𝕩', y: '𝕪', z: '𝕫',
          A: '𝔸', B: '𝔹', C: 'ℂ', D: '𝔻', E: '𝔼', F: '𝔽', G: '𝔾', H: 'ℍ', I: '𝕀', J: '𝕁', K: '𝕂', L: '𝕃', M: '𝕄',
          N: 'ℕ', O: '𝕆', P: 'ℙ', Q: 'ℚ', R: 'ℝ', S: '𝕊', T: '𝕋', U: '𝕌', V: '𝕍', W: '𝕎', X: '𝕏', Y: '𝕐', Z: 'ℤ',
          0: '𝟘', 1: '𝟙', 2: '𝟚', 3: '𝟛', 4: '𝟜', 5: '𝟝', 6: '𝟞', 7: '𝟕', 8: '𝟖', 9: '𝟗'
        }
      };

      const map = MAPS[style] || MAPS['bold-serif'];
      const converted = Array.from(text || '')
        .map((ch) => map[ch] || ch)
        .join('');

      // 和風・装飾罫線の付与
      return `┏━━━━━━━━━━━━━━━━━━━┓
  【 ${converted} 】
┗━━━━━━━━━━━━━━━━━━━┛`;
    },

    escapeXml(unsafe) {
      return (unsafe || '').replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
        }
      });
    }
  };

  return KazariEngineCore;
})();

// グローバル環境への確実な登録
if (typeof globalThis !== 'undefined') {
  globalThis.KazariEngine = KazariEngine;
}
if (typeof window !== 'undefined') {
  window.KazariEngine = KazariEngine;
}
