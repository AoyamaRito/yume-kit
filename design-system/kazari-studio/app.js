// @why: design/PHILOSOPHY.md の単機能・直列思想に基づき、3ステップの直列遷移、キーボードHUDショートカット、DONE静寂Dim、MarchingDots、Retinaエクスポートを統括するUIコントローラー
// @tags: SPEC, CONTROLLER, LINEAR_FLOW, SHORTCUTS, RETINA_EXPORT, TOAST

(function () {
  'use strict';

  // アプリケーション状態
  const state = {
    currentStep: 1, // 1 | 2 | 3
    options: null,
    darkMode: false,
    checkerMode: false,
    isProcessing: false
  };

  // DOM 要素の取得
  const dom = {
    html: document.documentElement,
    appContainer: document.getElementById('appContainer'),
    
    // ステップバッジ
    badgeStep1: document.getElementById('badgeStep1'),
    badgeStep2: document.getElementById('badgeStep2'),
    badgeStep3: document.getElementById('badgeStep3'),

    // ペイン
    paneStep1: document.getElementById('paneStep1'),
    paneStep2: document.getElementById('paneStep2'),
    paneStep3: document.getElementById('paneStep3'),

    // Marching Frames & プレビュー舞台
    frameStep1: document.getElementById('frameStep1'),
    frameStep2: document.getElementById('frameStep2'),
    stageStep1: document.getElementById('stageStep1'),
    stageStep2: document.getElementById('stageStep2'),
    canvasStep1: document.getElementById('canvasStep1'),
    canvasStep2: document.getElementById('canvasStep2'),
    canvasStep3: document.getElementById('canvasStep3'),

    // 舞台コントロール
    btnToggleDark1: document.getElementById('btnToggleDark1'),
    btnToggleChecker1: document.getElementById('btnToggleChecker1'),
    btnToggleDark2: document.getElementById('btnToggleDark2'),
    btnToggleChecker2: document.getElementById('btnToggleChecker2'),

    // 入力要素
    inputMainTitle: document.getElementById('inputMainTitle'),
    inputRuby: document.getElementById('inputRuby'),
    inputSubText: document.getElementById('inputSubText'),
    inputBadge: document.getElementById('inputBadge'),
    inputSealText: document.getElementById('inputSealText'),
    directionToggle: document.getElementById('directionToggle'),

    // プリセット & 微調整
    presetsGrid: document.getElementById('presetsGrid'),
    detailsDrawer: document.getElementById('detailsDrawer'),
    sliderFontSize: document.getElementById('sliderFontSize'),
    valFontSize: document.getElementById('valFontSize'),
    sliderLetterSpacing: document.getElementById('sliderLetterSpacing'),
    valLetterSpacing: document.getElementById('valLetterSpacing'),
    slider3dDepth: document.getElementById('slider3dDepth'),
    val3dDepth: document.getElementById('val3dDepth'),
    sliderStrokeWidth: document.getElementById('sliderStrokeWidth'),
    valStrokeWidth: document.getElementById('valStrokeWidth'),
    chkSeal: document.getElementById('chkSeal'),
    chkSpine: document.getElementById('chkSpine'),
    chkCrown: document.getElementById('chkCrown'),
    chkGlow: document.getElementById('chkGlow'),
    chkParticles: document.getElementById('chkParticles'),

    // DONE ステップ要素
    doneSeal: document.getElementById('doneSeal'),
    btnExportPng: document.getElementById('btnExportPng'),
    btnExportSvg: document.getElementById('btnExportSvg'),
    btnCopyImage: document.getElementById('btnCopyImage'),
    btnCopyCss: document.getElementById('btnCopyCss'),
    codeCssBox: document.getElementById('codeCssBox'),
    codeUnicodeBox: document.getElementById('codeUnicodeBox'),
    btnCopyCssQuick: document.getElementById('btnCopyCssQuick'),
    btnCopyUnicodeQuick: document.getElementById('btnCopyUnicodeQuick'),

    // フッターナビゲーション
    btnPrevStep: document.getElementById('btnPrevStep'),
    btnNextStep: document.getElementById('btnNextStep'),
    btnSkipStep: document.getElementById('btnSkipStep'),
    btnReset: document.getElementById('btnReset'),
    toastBubble: document.getElementById('toastBubble')
  };

  /**
   * 初期化
   */
  function init() {
    if (!state.options && typeof KazariEngine !== 'undefined') {
      state.options = KazariEngine.getDefaultOptions();
    }
    renderPresetCards();
    bindEvents();
    syncUIFromState();
    updatePreview();

    // Webフォント読み込み完了後に自動再描画（メトリクス正確化）
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        updatePreview();
      });
    }
  }

  /**
   * 8大プロ品質プリセットカードの動的生成
   */
  function renderPresetCards() {
    dom.presetsGrid.innerHTML = '';
    Object.values(KazariEngine.PRESETS).forEach((p) => {
      const card = document.createElement('div');
      card.className = `preset-card ${p.id === state.options.preset ? 'active' : ''}`;
      card.dataset.presetId = p.id;
      card.innerHTML = `
        <span class="preset-tag">${p.fontCategory === 'serif' ? '明朝' : 'ゴシック'}</span>
        <div class="preset-card-title">${p.name}</div>
        <div class="preset-card-desc">${p.desc}</div>
      `;
      card.addEventListener('click', () => {
        selectPreset(p.id);
      });
      dom.presetsGrid.appendChild(card);
    });
  }

  /**
   * プリセット選択
   */
  function selectPreset(presetId) {
    state.options.preset = presetId;
    const presetData = KazariEngine.PRESETS[presetId];
    if (presetData) {
      state.options = KazariEngine.resolveOptions({
        ...state.options,
        preset: presetId
      });
    }

    // カードの active クラス更新
    dom.presetsGrid.querySelectorAll('.preset-card').forEach((c) => {
      c.classList.toggle('active', c.dataset.presetId === presetId);
    });

    syncUIFromState();
    updatePreview();
  }

  /**
   * 状態からUIコントロールへ同期
   */
  function syncUIFromState() {
    const opts = state.options;

    dom.inputMainTitle.value = opts.text || '';
    dom.inputRuby.value = opts.ruby || '';
    dom.inputSubText.value = opts.subText || '';
    dom.inputBadge.value = opts.badgeText || '';
    dom.inputSealText.value = opts.ornaments?.seal?.text || '極';

    // 方向トグル
    dom.directionToggle.querySelectorAll('.toggle-option').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.direction === opts.direction);
    });

    // スライダー
    dom.sliderFontSize.value = opts.fontSize || 72;
    dom.valFontSize.textContent = `${opts.fontSize || 72}px`;
    dom.sliderLetterSpacing.value = opts.letterSpacing || 4;
    dom.valLetterSpacing.textContent = `${opts.letterSpacing || 4}px`;
    dom.slider3dDepth.value = opts.shadow3d?.depth || 2;
    dom.val3dDepth.textContent = `${opts.shadow3d?.depth || 2}px`;

    const maxStroke = (opts.strokes && opts.strokes[0]?.width) || 4;
    dom.sliderStrokeWidth.value = maxStroke;
    dom.valStrokeWidth.textContent = `${maxStroke}px`;

    // チェックボックス
    dom.chkSeal.checked = !!opts.ornaments?.seal?.show;
    dom.chkSpine.checked = !!opts.ornaments?.spine?.show;
    dom.chkCrown.checked = !!opts.ornaments?.crown?.show;
    dom.chkGlow.checked = !!opts.glow?.enabled;
    dom.chkParticles.checked = !!opts.ornaments?.particles?.show;

    // DONE 落款文字
    if (dom.doneSeal) {
      dom.doneSeal.textContent = opts.ornaments?.seal?.text || '極';
    }
  }

  /**
   * UIコントロールから状態へ同期
   */
  function syncStateFromUI() {
    state.options.text = dom.inputMainTitle.value.trim();
    state.options.ruby = dom.inputRuby.value.trim();
    state.options.subText = dom.inputSubText.value.trim();
    state.options.badgeText = dom.inputBadge.value.trim();

    if (!state.options.ornaments) state.options.ornaments = {};
    if (!state.options.ornaments.seal) state.options.ornaments.seal = { show: true, color: '#D9381E' };
    state.options.ornaments.seal.text = dom.inputSealText.value.trim() || '極';

    state.options.fontSize = parseInt(dom.sliderFontSize.value, 10);
    state.options.letterSpacing = parseInt(dom.sliderLetterSpacing.value, 10);

    if (!state.options.shadow3d) state.options.shadow3d = {};
    state.options.shadow3d.depth = parseInt(dom.slider3dDepth.value, 10);

    const strokeWidth = parseInt(dom.sliderStrokeWidth.value, 10);
    if (state.options.strokes && state.options.strokes.length > 0) {
      state.options.strokes[0].width = strokeWidth;
    }

    state.options.ornaments.seal.show = dom.chkSeal.checked;
    state.options.ornaments.spine.show = dom.chkSpine.checked;
    state.options.ornaments.crown.show = dom.chkCrown.checked;
    state.options.glow.enabled = dom.chkGlow.checked;
    state.options.ornaments.particles.show = dom.chkParticles.checked;
  }

  /**
   * プレビュー Canvas の再描画
   */
  function updatePreview() {
    // 描画対象 Canvas の選択
    let targetCanvas;
    if (state.currentStep === 1) targetCanvas = dom.canvasStep1;
    else if (state.currentStep === 2) targetCanvas = dom.canvasStep2;
    else targetCanvas = dom.canvasStep3;

    if (!targetCanvas) return;

    // 2x 描画でRetina鮮明表示
    KazariEngine.renderCanvas(targetCanvas, state.options, 2);

    // CSS スニペット & Unicode 装飾テキストの更新
    if (state.currentStep === 3) {
      dom.codeCssBox.textContent = KazariEngine.generateCSS(state.options);
      dom.codeUnicodeBox.textContent = KazariEngine.generateUnicodeFancy(state.options.text || 'KAZARI', 'bold-serif');
    }
  }

  /**
   * 直列ステップ遷移の制御
   */
  function setStep(step) {
    if (step < 1 || step > 3) return;

    // Step 1 から進む際のバリデーション（空タイトルチェック）
    if (step > 1 && !dom.inputMainTitle.value.trim()) {
      triggerInputShake();
      return;
    }

    state.currentStep = step;

    // ペインの切り替え
    dom.paneStep1.classList.toggle('active', step === 1);
    dom.paneStep2.classList.toggle('active', step === 2);
    dom.paneStep3.classList.toggle('active', step === 3);

    // バッジの更新
    dom.badgeStep1.classList.toggle('active', step === 1);
    dom.badgeStep2.classList.toggle('active', step === 2);
    dom.badgeStep3.classList.toggle('active', step === 3);

    // DONE 静寂Dim モードの適用
    if (step === 3) {
      dom.appContainer.classList.add('is-dimmed');
    } else {
      dom.appContainer.classList.remove('is-dimmed');
    }

    // フッターボタンの表示制御
    dom.btnPrevStep.style.display = step > 1 ? 'inline-flex' : 'none';
    dom.btnSkipStep.style.display = step === 2 ? 'inline-flex' : 'none';

    if (step === 1) {
      dom.btnNextStep.textContent = 'プリセット選択へ進む →';
      dom.btnNextStep.style.display = 'inline-flex';
    } else if (step === 2) {
      dom.btnNextStep.textContent = '完了して受け取る (DONE) →';
      dom.btnNextStep.style.display = 'inline-flex';
    } else {
      dom.btnNextStep.style.display = 'none';
    }

    updatePreview();
  }

  /**
   * 未入力時の微細振動 (Shake) + 朱 Tint
   */
  function triggerInputShake() {
    dom.inputMainTitle.classList.remove('is-invalid');
    void dom.inputMainTitle.offsetWidth; // リフロー強制
    dom.inputMainTitle.classList.add('is-invalid');
    dom.inputMainTitle.focus();

    setTimeout(() => {
      dom.inputMainTitle.classList.remove('is-invalid');
    }, 1200);
  }

  /**
   * クリップボード コピートースト表示
   */
  function showToast(message = '📋 クリップボードにコピーしました') {
    dom.toastBubble.textContent = message;
    dom.toastBubble.classList.add('show');
    setTimeout(() => {
      dom.toastBubble.classList.remove('show');
    }, 2000);
  }

  /**
   * 透過 PNG のダウンロード (4x Retina)
   */
  function downloadPNG() {
    const exportCanvas = document.createElement('canvas');
    KazariEngine.renderCanvas(exportCanvas, state.options, 4);

    const link = document.createElement('a');
    link.download = `kazari_${(state.options.text || 'title').replace(/\s+/g, '_')}_4x.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    showToast('💾 透過PNG (4x Retina) を保存しました');
  }

  /**
   * ベクター SVG のダウンロード
   */
  function downloadSVG() {
    const svgCode = KazariEngine.generateSVG(state.options);
    const blob = new Blob([svgCode], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `kazari_${(state.options.text || 'title').replace(/\s+/g, '_')}.svg`;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('📐 ベクター SVG を書き出しました');
  }

  /**
   * クリップボードへ画像を直接コピー
   */
  async function copyImageToClipboard() {
    const exportCanvas = document.createElement('canvas');
    KazariEngine.renderCanvas(exportCanvas, state.options, 2);

    try {
      exportCanvas.toBlob(async (blob) => {
        if (!blob) return;
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        showToast('📋 画像をクリップボードにコピーしました');
      });
    } catch (err) {
      console.warn('Clipboard write failed:', err);
      showToast('⚠️ クリップボードへの画像直接コピーは非対応ブラウザです');
    }
  }

  /**
   * クリップボードへテキストをコピー
   */
  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(msg || '📋 コピーしました');
    } catch (err) {
      console.warn('Copy text failed:', err);
    }
  }

  /**
   * イベントリスナーの登録
   */
  function bindEvents() {
    // 伝統色アクセントスイッチャー
    document.querySelectorAll('[data-set-accent]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const accent = e.currentTarget.dataset.setAccent;
        dom.html.setAttribute('data-accent', accent);
      });
    });

    // リアルタイム入力バインディング
    [dom.inputMainTitle, dom.inputRuby, dom.inputSubText, dom.inputBadge, dom.inputSealText].forEach((el) => {
      el.addEventListener('input', () => {
        syncStateFromUI();
        updatePreview();
      });
    });

    // 書字方向トグル
    dom.directionToggle.querySelectorAll('.toggle-option').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        state.options.direction = e.currentTarget.dataset.direction;
        dom.directionToggle.querySelectorAll('.toggle-option').forEach((b) => {
          b.classList.toggle('active', b === e.currentTarget);
        });
        updatePreview();
      });
    });

    // スライダー変更
    dom.sliderFontSize.addEventListener('input', (e) => {
      dom.valFontSize.textContent = `${e.target.value}px`;
      syncStateFromUI();
      updatePreview();
    });
    dom.sliderLetterSpacing.addEventListener('input', (e) => {
      dom.valLetterSpacing.textContent = `${e.target.value}px`;
      syncStateFromUI();
      updatePreview();
    });
    dom.slider3dDepth.addEventListener('input', (e) => {
      dom.val3dDepth.textContent = `${e.target.value}px`;
      syncStateFromUI();
      updatePreview();
    });
    dom.sliderStrokeWidth.addEventListener('input', (e) => {
      dom.valStrokeWidth.textContent = `${e.target.value}px`;
      syncStateFromUI();
      updatePreview();
    });

    // チェックボックス変更
    [dom.chkSeal, dom.chkSpine, dom.chkCrown, dom.chkGlow, dom.chkParticles].forEach((chk) => {
      chk.addEventListener('change', () => {
        syncStateFromUI();
        updatePreview();
      });
    });

    // 舞台背景明暗・チェッカー切替
    const toggleDark = () => {
      state.darkMode = !state.darkMode;
      dom.stageStep1.classList.toggle('dark-mode', state.darkMode);
      dom.stageStep2.classList.toggle('dark-mode', state.darkMode);
    };
    const toggleChecker = () => {
      state.checkerMode = !state.checkerMode;
      dom.stageStep1.classList.toggle('checkered', state.checkerMode);
      dom.stageStep2.classList.toggle('checkered', state.checkerMode);
    };
    dom.btnToggleDark1.addEventListener('click', toggleDark);
    dom.btnToggleDark2.addEventListener('click', toggleDark);
    dom.btnToggleChecker1.addEventListener('click', toggleChecker);
    dom.btnToggleChecker2.addEventListener('click', toggleChecker);

    // 直列ナビゲーション
    dom.btnNextStep.addEventListener('click', () => {
      setStep(state.currentStep + 1);
    });
    dom.btnPrevStep.addEventListener('click', () => {
      setStep(state.currentStep - 1);
    });
    dom.btnSkipStep.addEventListener('click', () => {
      setStep(3);
    });

    // 全消去
    dom.btnReset.addEventListener('click', () => {
      dom.inputMainTitle.value = '';
      dom.inputRuby.value = '';
      dom.inputSubText.value = '';
      dom.inputBadge.value = '';
      state.options = KazariEngine.getDefaultOptions();
      state.options.text = '';
      syncUIFromState();
      setStep(1);
      triggerInputShake();
    });

    // エクスポートボタン
    dom.btnExportPng.addEventListener('click', downloadPNG);
    dom.btnExportSvg.addEventListener('click', downloadSVG);
    dom.btnCopyImage.addEventListener('click', copyImageToClipboard);
    dom.btnCopyCss.addEventListener('click', () => {
      copyText(dom.codeCssBox.textContent, '💻 CSSコードをコピーしました');
    });
    dom.btnCopyCssQuick.addEventListener('click', () => {
      copyText(dom.codeCssBox.textContent, '💻 CSSコードをコピーしました');
    });
    dom.btnCopyUnicodeQuick.addEventListener('click', () => {
      copyText(dom.codeUnicodeBox.textContent, '✨ 装飾テキストをコピーしました');
    });

    // キーボードショートカット (左右HUD連動)
    window.addEventListener('keydown', (e) => {
      // 入力フィールドフォーカス中は通常の入力を優先
      const isInputFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

      if (e.key === 'Escape') {
        if (state.currentStep > 1) {
          e.preventDefault();
          setStep(state.currentStep - 1);
        }
      } else if (e.key === ' ' && !isInputFocused) {
        if (state.currentStep === 2) {
          e.preventDefault();
          setStep(3);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (state.currentStep < 3) {
          setStep(state.currentStep + 1);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        downloadPNG();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        downloadSVG();
      }
    });
  }

  // DOM 読み込み完了後に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
