// KILOTON — ui_css.js   OWNER: UI. The whole interface stylesheet (injected once by ui.js).
// Everything is scoped under .ku and sized in em from one clamp()-ed root size, so the cluster scales as a unit.
export const FONT_URL = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap';

export const CSS = `
.ku{position:absolute;inset:0;overflow:hidden;pointer-events:none;
  --f:"Barlow Condensed","Roboto Condensed","Arial Narrow","Avenir Next Condensed","DIN Condensed","Helvetica Neue",Arial,sans-serif;
  --gl:max(16px,2.4vmin,env(safe-area-inset-left,0px));--gr:max(16px,2.4vmin,env(safe-area-inset-right,0px));--gv:max(14px,2.4vmin);
  --ink:var(--kt-ink,#e9e4d8);--dim:#a9adb3;--cy:var(--kt-cyan,#49e0d2);--am:var(--kt-amber,#ffb23e);--rd:var(--kt-red,#ff4b3a);
  --k:4,6,9;--plate:rgba(var(--k),.72);--hair:rgba(233,228,216,.3);
  --sh:0 0 .09em rgb(var(--k)),0 0 .2em rgba(var(--k),.95),0 0 .55em rgba(var(--k),.6),0 .07em .1em rgba(var(--k),.9);
  font-family:var(--f);font-stretch:condensed;font-size:clamp(12px,calc(.9vmin + 6.5px),20px);line-height:1.12;font-weight:600;
  letter-spacing:.09em;text-transform:uppercase;font-variant-numeric:tabular-nums lining-nums;color:var(--ink);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.ku [hidden]{display:none!important}
.ku *,.ku *::before,.ku *::after{box-sizing:border-box}
.ku h1,.ku h2,.ku h3,.ku p,.ku dl,.ku dd,.ku dt{margin:0;font:inherit;letter-spacing:inherit}
.ku kbd{display:inline-block;min-width:1.7em;padding:.08em .38em .06em;border:1px solid rgba(233,228,216,.6);background:rgba(var(--k),.55);
  font:inherit;font-size:.86em;font-weight:700;letter-spacing:.06em;text-align:center;color:var(--ink);line-height:1.2;text-shadow:none}

/* ------------------------------------------------------------------ HUD */
.ku-hud{--dim:#c9ccd1;position:absolute;inset:0;text-shadow:var(--sh);transition:opacity .25s ease}
.ku-hud.dim{opacity:0}
.ku-vig,.ku-flash{position:absolute;inset:0;opacity:0;will-change:opacity}
.ku-vig{background:radial-gradient(ellipse at 50% 50%,rgba(255,40,24,0) 52%,rgba(190,20,10,.42) 84%,rgba(120,6,4,.78) 100%)}
.ku-flash{background:radial-gradient(ellipse at 50% 50%,rgba(255,60,40,0) 40%,rgba(255,60,40,.5) 100%)}
.ku-bar{position:relative;height:.72em;background:rgba(var(--k),.72);box-shadow:0 0 0 1px rgba(var(--k),.8)}
.ku-bar i{position:absolute;inset:0;transform-origin:0 50%;background:var(--cy);will-change:transform}
.ku-bar i.lag{background:var(--ink);opacity:.85}
.ku-bar u{position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(5% - 2px),rgba(var(--k),.9) calc(5% - 2px),rgba(var(--k),.9) 5%)}
.ku-bar.s{height:.34em}.ku-bar.xs{height:.22em}
.ku-lab{font-size:.9em;letter-spacing:.16em;color:var(--dim)}

/* crosshair + centre overlays */
.ku-xh{position:absolute;left:50%;top:50%;width:9.4em;height:9.4em;margin:-4.7em 0 0 -4.7em;overflow:visible}
.ku-xh .o{fill:none;stroke:rgba(var(--k),.62);stroke-width:3.4;stroke-linecap:square}
.ku-xh .f{fill:none;stroke:var(--ink);stroke-width:1.5;stroke-linecap:butt}
.ku-xh .v{display:none}
.ku-xh.x-rifle .v-rifle,.ku-xh.x-launcher .v-launcher,.ku-xh.x-pulse .v-pulse,.ku-xh.x-salvo .v-salvo,.ku-xh.x-lock .v-lock,.ku-xh.x-none .v-none{display:inline}
.ku-xh .dot.f{fill:var(--ink);stroke:none}.ku-xh .dot.o{fill:rgba(var(--k),.7);stroke:none}
.ku-xh .arc-t{fill:none;stroke:rgba(var(--k),.55);stroke-width:3.6}
.ku-xh .arc-v{fill:none;stroke:var(--cy);stroke-width:1.9}
.ku-xh .arc-v.hot{stroke:var(--am)}.ku-xh .arc-v.bad{stroke:var(--rd)}
.ku-xh .hit,.ku-xh .kill{opacity:0}
.ku-xh .hit .f{stroke:#fff;stroke-width:1.8}
.ku-xh .kill .f{stroke:var(--rd);stroke-width:2.6}.ku-xh .kill .o{stroke-width:4.6}
.ku-arcs{position:absolute;left:50%;top:50%;width:58vmin;height:58vmin;margin:-29vmin 0 0 -29vmin;overflow:visible}
.ku-arcs g{opacity:0}
.ku-arcs .o{fill:none;stroke:rgba(var(--k),.55);stroke-width:4.2}
.ku-arcs .f{fill:none;stroke:var(--rd);stroke-width:2.2}
.ku-arcs .p{fill:var(--rd);stroke:rgba(var(--k),.6);stroke-width:1}
.ku-warn{position:absolute;left:50%;top:39%;transform:translateX(-50%);display:flex;align-items:center;gap:.6em;padding:.28em .8em .22em;
  background:rgba(60,8,4,.72);border:1px solid var(--rd);color:#fff;font-size:1.15em;font-weight:700;letter-spacing:.24em;white-space:nowrap;animation:ku-blink .5s steps(2,jump-none) infinite}
.ku-warn::before,.ku-warn::after{content:"";width:.5em;height:.5em;background:var(--rd);transform:rotate(45deg)}
.ku-prompt{position:absolute;left:50%;top:61%;transform:translateX(-50%);display:flex;align-items:center;gap:.6em;padding:.34em .85em .3em .4em;
  background:var(--plate);border-left:2px solid var(--cy);font-size:1.08em;white-space:nowrap;max-width:calc(100% - var(--gl) - var(--gr))}
.ku-prompt kbd{font-size:1em;border-color:var(--cy);color:var(--cy);min-width:1.9em}
.ku-prompt.nokey{padding-left:.85em}

/* world-anchored markers and lock brackets (pooled, moved with transforms) */
.ku-world{position:absolute;inset:0;overflow:hidden}
.ku-mk,.ku-lk{position:absolute;left:0;top:0;will-change:transform}
.ku-mk{width:0;height:0;color:var(--cy)}
.ku-mk .ic{position:absolute;left:-.55em;top:-.55em;width:1.1em;height:1.1em;border:2px solid currentColor;background:rgba(var(--k),.55);transform:rotate(45deg);box-shadow:0 0 0 1px rgba(var(--k),.7)}
.ku-mk .ic::after{content:"";position:absolute;inset:.2em;background:currentColor}
.ku-mk .ar{position:absolute;left:-.4em;top:-1.75em;width:0;height:0;border:.4em solid transparent;border-bottom:.6em solid currentColor;border-top:0;transform-origin:.4em 1.75em;display:none;filter:drop-shadow(0 0 1px rgba(var(--k),.9))}
.ku-mk.off .ar{display:block}
.ku-mk .tx{position:absolute;left:50%;top:1em;transform:translateX(-50%);text-align:center;white-space:nowrap;font-size:.86em;letter-spacing:.14em;line-height:1.2}
.ku-mk .tx b{display:block;font-weight:700}.ku-mk .tx span{display:block;color:var(--ink)}
.ku-mk.warn{color:var(--am)}.ku-mk.bad{color:var(--rd)}
.ku-mk.pulse .ic{animation:ku-pulse .8s ease-in-out infinite}
.ku-lk{color:var(--cy)}
.ku-lk i{position:absolute;width:26%;height:26%;min-width:6px;min-height:6px;border:2px solid currentColor;filter:drop-shadow(0 0 1px rgba(var(--k),1))}
.ku-lk i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}.ku-lk i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
.ku-lk i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}.ku-lk i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
.ku-lk b{position:absolute;left:50%;top:100%;margin-top:.35em;transform:translateX(-50%);font-size:.8em;letter-spacing:.2em;white-space:nowrap;padding:.05em .4em;background:rgba(var(--k),.6)}
.ku-lk.locked{color:var(--am)}.ku-lk.locked b{background:var(--am);color:#14100a;text-shadow:none}

/* top centre: wave status, banner, toasts */
.ku-top{position:absolute;top:var(--gv);left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.55em;width:min(36em,calc(100% - var(--gl) - var(--gr) - 25em))}
.ku-wave{display:flex;flex-direction:column;align-items:center;gap:.3em}
.ku-wv-r{display:flex;align-items:baseline;gap:.5em;white-space:nowrap}
.ku-wv-r b{font-size:1.9em;font-weight:700;letter-spacing:.04em;line-height:.9}
.ku-wv-r .sep{width:1px;height:1.35em;background:var(--hair);align-self:center;margin:0 .35em;box-shadow:0 0 0 1px rgba(var(--k),.4)}
.ku-wave .ku-bar{width:13em}.ku-wave .ku-bar i{background:var(--rd)}
.ku-wave.inter .ku-bar i{background:var(--cy)}
.ku-wv-m{color:var(--rd);font-size:.84em;letter-spacing:.18em;display:flex;align-items:center;gap:.5em}
.ku-wv-m::before{content:"";width:.55em;height:.55em;background:var(--rd);transform:rotate(45deg);box-shadow:0 0 0 1px rgba(var(--k),.8)}
.ku-ban{display:none;flex-direction:column;align-items:center;margin-top:.6em;text-align:center}
.ku-ban.on{display:flex;animation:ku-ban 3.4s cubic-bezier(.2,.8,.2,1) both}
.ku-ban b{font-size:3em;font-weight:700;letter-spacing:.2em;margin-right:-.2em;line-height:1;white-space:nowrap}
.ku-ban span{display:flex;align-items:center;gap:.8em;font-size:.95em;letter-spacing:.3em;margin-top:.4em;color:var(--am);white-space:nowrap}
.ku-ban span::before,.ku-ban span::after{content:"";width:3.5em;height:1px;background:currentColor;box-shadow:0 0 0 1px rgba(var(--k),.45)}
.ku-ban.good span{color:var(--cy)}
.ku-toast{display:none;min-width:12em;max-width:100%;padding:.34em .9em .3em .75em;background:var(--plate);border-left:2px solid var(--ink);text-align:left}
.ku-toast.on{display:block;animation:ku-in .22s ease-out both}
.ku-toast.out{opacity:0;transition:opacity .3s ease}
.ku-toast b{display:block;font-size:1.02em;letter-spacing:.14em}
.ku-toast span{display:block;font-size:.84em;color:var(--dim);letter-spacing:.1em;margin-top:.12em;text-transform:none;font-weight:500}
.ku-toast.warn{border-color:var(--am)}.ku-toast.warn b{color:var(--am)}
.ku-toast.good{border-color:var(--cy)}.ku-toast.good b{color:var(--cy)}
.ku-toast.bad{border-color:var(--rd)}.ku-toast.bad b{color:var(--rd)}

/* top left: radar. top right: score + feed */
.ku-tl{position:absolute;top:var(--gv);left:var(--gl);width:11em}
.ku-radar{display:block;width:11em;height:11em}
.ku-rd-f{display:flex;justify-content:space-between;margin-top:.3em;font-size:.84em;letter-spacing:.14em;color:var(--ink)}
.ku-rd-f b{color:var(--ink);font-weight:600}
.ku-tips{margin-top:1.1em;width:17em;max-width:calc(100vw - var(--gl) - var(--gr));padding:.5em .75em .5em .7em;background:var(--plate);border-left:2px solid var(--cy);display:none}
.ku-tips.on{display:block;animation:ku-in .3s ease-out both}
.ku-tips small{display:block;font-size:.76em;letter-spacing:.22em;color:var(--cy);margin-bottom:.3em}
.ku-tips p{font-size:.95em;letter-spacing:.05em;line-height:1.5;text-transform:none;font-weight:500}
.ku-tr{position:absolute;top:var(--gv);right:var(--gr);display:flex;flex-direction:column;align-items:flex-end;text-align:right;min-width:9em}
.ku-score{display:flex;flex-direction:column;align-items:flex-end}
.ku-score b{font-size:1.9em;font-weight:700;letter-spacing:.04em;line-height:1}
.ku-score-r{display:flex;gap:.9em;margin-top:.25em;font-size:.84em;letter-spacing:.14em;color:var(--dim)}
.ku-score-r em{font-style:normal;color:var(--ink)}
.ku-combo{color:var(--am)}
.ku-feed{margin-top:.7em;display:flex;flex-direction:column;align-items:flex-end;gap:.22em;font-size:.88em;letter-spacing:.12em}
.ku-feed div{display:none;gap:.6em;white-space:nowrap}
.ku-feed div.on{display:flex;animation:ku-inr .2s ease-out both}
.ku-feed div:nth-child(n+3){opacity:.6}
.ku-feed em{font-style:normal;color:var(--cy);font-weight:700}

/* bottom cluster */
.ku-bot{position:absolute;left:var(--gl);right:var(--gr);bottom:var(--gv);display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);grid-template-areas:"bl bc br";align-items:end;column-gap:1.4em;row-gap:.7em}
.ku-bl{grid-area:bl;justify-self:start;width:19em;max-width:100%}
.ku-vh{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.28em}
.ku-vh b{font-size:1.9em;font-weight:700;letter-spacing:.03em;line-height:.9}
.ku-vh b small{font-size:.45em;font-weight:600;letter-spacing:.12em;color:var(--dim);margin-left:.4em}
.ku-vit.low .ku-vh b{color:var(--rd)}.ku-vit.low .ku-hp .fill{background:var(--rd)}
.ku-vit.low .ku-hp{animation:ku-blink 1s steps(2,jump-none) infinite}
.ku-tag{font-style:normal;margin-left:.8em;padding:.08em .5em .04em;border:1px solid var(--ink);color:var(--ink);background:rgba(var(--k),.6);letter-spacing:.16em;font-size:.92em}
.ku-tag.cov{border-color:var(--cy);color:var(--cy)}
.ku-vsub{display:flex;gap:1.1em;margin-top:.55em}
.ku-mini{flex:1;display:flex;align-items:center;gap:.5em;font-size:.84em;letter-spacing:.14em;color:var(--dim);min-width:0}
.ku-mini .ku-bar{flex:1}
.ku-mini b{color:var(--ink);font-weight:600;min-width:1.9em;text-align:right}
.ku-mini.jet .ku-bar i{background:var(--ink)}
.ku-mini.jet.low .ku-bar i{background:var(--am)}
.ku-mini.pil.low .ku-bar i{background:var(--rd)}
.ku-bc{grid-area:bc;justify-self:center;width:21em;max-width:100%;text-align:center}
.ku-mt-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.3em}
.ku-mt-h b{font-weight:600}
.ku-mt .ku-bar{height:.42em}
.ku-mt .ku-bar u{background:repeating-linear-gradient(90deg,transparent 0,transparent calc(25% - 1px),rgba(233,228,216,.5) calc(25% - 1px),rgba(233,228,216,.5) 25%)}
.ku-mt-rdy{display:none;align-items:center;justify-content:center;gap:.7em;padding:.5em 1em .44em;background:rgba(6,34,34,.74);border:1px solid var(--cy);color:var(--cy);font-size:1.3em;font-weight:700;letter-spacing:.2em;white-space:nowrap;box-shadow:0 0 0 1px rgba(var(--k),.7),0 0 1.4em rgba(73,224,210,.35);animation:ku-rdy 1.1s ease-in-out infinite}
.ku-mt-rdy kbd{font-size:1em;background:var(--cy);color:#06201f;border-color:var(--cy);min-width:1.9em}
.ku-mt-rdy i{width:1.2em;height:1px;background:currentColor;opacity:.8}
.ku-mt-sub{display:none;margin-top:.4em;font-size:.8em;letter-spacing:.2em;color:var(--ink)}
.ku-mt.ready .ku-mt-rdy{display:flex}.ku-mt.ready .ku-mt-sub{display:block}.ku-mt.ready .ku-mt-h,.ku-mt.ready .ku-bar{display:none}
.ku-mt.drop .ku-mt-h b{color:var(--cy);font-size:1.25em;font-weight:700}
.ku-mt.drop .ku-mt-h .ku-lab{color:var(--cy)}
.ku-br{grid-area:br;justify-self:end;display:flex;flex-direction:column;align-items:flex-end;gap:.55em;max-width:100%}
.ku-hints{display:flex;gap:.95em;font-size:.8em;letter-spacing:.12em;color:var(--ink);white-space:nowrap}
.ku-hints span{display:flex;align-items:center;gap:.4em}
.ku-wps{display:flex;gap:.45em;max-width:100%}
.ku-wp{display:none;flex-direction:column;width:11.6em;min-width:0;padding:.42em .6em .5em;background:linear-gradient(180deg,rgba(var(--k),.5),rgba(var(--k),.78));border-top:1px solid var(--hair);position:relative}
.ku-wp.on{display:flex}
.ku-wp::before{content:"";position:absolute;left:0;top:-1px;width:1.4em;height:2px;background:var(--dim)}
.ku-wp.act::before{background:var(--cy);width:100%}
.ku-wp-h{display:flex;align-items:center;gap:.45em;min-width:0}
.ku-wp-h span{font-size:.86em;letter-spacing:.07em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ku-wp-m{display:flex;align-items:baseline;justify-content:space-between;gap:.3em;margin:.34em 0 .36em;min-width:0}
.ku-wp-m b{font-size:1.75em;font-weight:700;letter-spacing:.03em;line-height:.92;white-space:nowrap}
.ku-wp-m b small{font-size:.48em;font-weight:600;color:var(--dim);margin-left:.25em;letter-spacing:.1em}
.ku-wp-m em{font-style:normal;font-size:.76em;letter-spacing:.14em;color:var(--dim);white-space:nowrap}
.ku-wp .ku-bar{height:.26em}
.ku-wp.rdy .ku-wp-m em{color:var(--cy)}
.ku-wp.wait .ku-wp-m b{color:var(--dim)}.ku-wp.wait .ku-bar i{background:var(--ink)}
.ku-wp.hot .ku-wp-m b{color:var(--am)}.ku-wp.hot .ku-bar i{background:var(--am)}.ku-wp.hot .ku-wp-m em{color:var(--am)}
.ku-wp.bad{border-top-color:var(--rd)}.ku-wp.bad::before{background:var(--rd);width:100%}
.ku-wp.bad .ku-wp-m b,.ku-wp.bad .ku-wp-m em{color:var(--rd)}.ku-wp.bad .ku-bar i{background:var(--rd)}
.ku-wp.bad .ku-wp-m em{animation:ku-blink .45s steps(2,jump-none) infinite}
.ku-capt{position:absolute;left:50%;bottom:calc(var(--gv) + 7.5em);transform:translateX(-50%);padding:.3em .8em;background:var(--plate);border:1px solid var(--hair);font-size:.9em;letter-spacing:.16em;white-space:nowrap}

/* ------------------------------------------------------------------ menus */
.ku-scr{position:absolute;inset:0;pointer-events:auto;cursor:default}
.ku-btn{appearance:none;-webkit-appearance:none;margin:0;font:inherit;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--ink);cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:.8em;min-height:2.7em;padding:.5em 1.25em .44em;background:rgba(var(--k),.5);border:1px solid rgba(233,228,216,.55);border-radius:0;
  transition:background .12s,color .12s,border-color .12s;white-space:nowrap;text-shadow:none}
.ku-btn:hover{background:var(--ink);color:#0b0d10;border-color:var(--ink)}
.ku-btn:hover kbd{color:#0b0d10;border-color:#0b0d10;background:none}
.ku-btn:active{transform:translateY(1px)}
.ku-btn.pri{background:var(--cy);color:#06201f;border-color:var(--cy);clip-path:polygon(0 0,100% 0,100% calc(100% - .7em),calc(100% - .7em) 100%,0 100%)}
.ku-btn.pri kbd{color:#06201f;border-color:rgba(6,32,31,.6);background:none}
.ku-btn.pri:hover{background:#fff;border-color:#fff}
.ku-btn.big{font-size:1.35em;min-height:2.6em;padding:.5em 1.5em .44em 1.3em}
.ku-btn.sec{background:rgba(var(--k),.55)}
.ku-btn.arm{background:var(--am);color:#1a1206;border-color:var(--am)}
.ku-btn:focus-visible,.ku-seg button:focus-visible,.ku-sw:focus-visible,.ku input[type=range]:focus-visible{outline:2px solid var(--am);outline-offset:3px}
.ku-btn.pri:focus-visible{clip-path:none}
.ku-note{font-size:.84em;letter-spacing:.1em;color:var(--dim);text-transform:none;font-weight:500;min-height:1.2em}
.ku-note.warn{color:var(--am)}
.ku-note:empty{display:none}

/* title */
.ku-title{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto 1fr auto;grid-template-areas:"top top" ". ." "main ref";column-gap:2.5em;
  padding:var(--gv) var(--gr) calc(var(--gv) + .4em) var(--gl);text-shadow:var(--sh)}
.ku-t-scrim{position:absolute;inset:0;pointer-events:none;background:linear-gradient(0deg,rgba(var(--k),.84) 0,rgba(var(--k),.52) 24%,rgba(var(--k),0) 56%),linear-gradient(180deg,rgba(var(--k),.4) 0,rgba(var(--k),0) 16%)}
.ku-t-top{grid-area:top;position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:.3em .8em;font-size:.86em;letter-spacing:.24em}
.ku-t-top i{font-style:normal;color:var(--dim)}
.ku-t-top::before{content:"";width:.6em;height:.6em;background:var(--cy);box-shadow:0 0 0 1px rgba(var(--k),.7)}
.ku-t-top span:last-child{margin-left:auto;color:var(--dim)}
.ku-t-main{grid-area:main;position:relative;align-self:end;min-width:0}
.ku-logo{display:block;width:clamp(250px,47vw,860px);max-width:100%;filter:drop-shadow(0 .2em 1.2em rgba(var(--k),.55))}
.ku-logo svg{display:block;width:100%;height:auto;overflow:visible}
.ku-logo .lt{fill:var(--ink)}.ku-logo .vx{fill:var(--cy)}.ku-logo .vx2{fill:var(--ink)}
.ku-pitch{margin-top:1.05em!important;font-size:1.22em;letter-spacing:.2em;max-width:34em;line-height:1.35}
.ku-pitch em{font-style:normal;color:var(--cy)}
.ku-t-row{display:flex;flex-wrap:wrap;align-items:stretch;gap:1em 1.6em;margin-top:1.5em}
.ku-best{display:flex;flex-direction:column;justify-content:center;padding-left:1.1em;border-left:1px solid var(--hair)}
.ku-best span{font-size:.8em;letter-spacing:.22em;color:var(--dim)}
.ku-best b{font-size:1.9em;font-weight:700;letter-spacing:.05em;line-height:1}
.ku-title .ku-note{margin-top:1em!important}
.ku-credit{margin-top:.5em!important;font-size:.78em;letter-spacing:.24em;color:var(--dim)}
.ku-t-ref{grid-area:ref;position:relative;align-self:end;padding-bottom:.1em}
.ku-ref{display:grid;grid-template-columns:auto auto;gap:0 2.2em}
.ku-ref h3{font-size:.8em!important;letter-spacing:.26em!important;color:var(--cy);padding-bottom:.4em;margin-bottom:.45em!important;border-bottom:1px solid var(--hair)}
.ku-ref dl{display:grid;grid-template-columns:auto 1fr;gap:.26em .8em;align-items:center;font-size:.86em;letter-spacing:.1em}
.ku-ref dt{display:flex;gap:.25em;white-space:nowrap}
.ku-ref dd{white-space:nowrap;color:var(--ink)}
.ku-ref dd small{font-size:1em;color:var(--dim)}

/* pause */
.ku-pause{display:grid;place-items:center;padding:var(--gv) var(--gr) var(--gv) var(--gl);background:rgba(var(--k),.62)}
.ku-card{width:min(54em,100%);max-height:100%;overflow:auto;overscroll-behavior:contain;background:rgba(10,13,17,.9);border:1px solid var(--hair);border-top:2px solid var(--cy);padding:1.5em 1.7em 1.4em;scrollbar-width:thin;scrollbar-color:var(--dim) transparent}
.ku-card header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:1em 1.5em;padding-bottom:1.2em;border-bottom:1px solid var(--hair)}
.ku-card header small{display:block;font-size:.8em;letter-spacing:.26em;color:var(--cy);margin-bottom:.3em}
.ku-card h2{font-size:2.5em!important;font-weight:700!important;letter-spacing:.14em!important;line-height:.9}
.ku-acts{display:flex;flex-wrap:wrap;gap:.6em}
.ku-cols{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1.4em 2.6em;margin-top:1.3em}
.ku-cols>section>h3{font-size:.8em!important;letter-spacing:.26em!important;color:var(--dim);margin-bottom:.8em!important}
.ku-row{display:grid;grid-template-columns:9.5em minmax(0,1fr) 3.4em;align-items:center;gap:.9em;min-height:2.5em;font-size:.95em;letter-spacing:.1em}
.ku-row output{text-align:right;color:var(--cy)}
.ku input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:1.6em;margin:0;background:none;cursor:pointer;--p:50%}
.ku input[type=range]::-webkit-slider-runnable-track{height:3px;background:linear-gradient(90deg,var(--cy) var(--p),rgba(233,228,216,.28) var(--p))}
.ku input[type=range]::-moz-range-track{height:3px;background:linear-gradient(90deg,var(--cy) var(--p),rgba(233,228,216,.28) var(--p))}
.ku input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:.6em;height:1.3em;margin-top:calc(1.5px - .65em);background:var(--ink);border:0;border-radius:0}
.ku input[type=range]::-moz-range-thumb{width:.6em;height:1.3em;background:var(--ink);border:0;border-radius:0}
.ku-seg{display:flex;gap:0;grid-column:2 / 4}
.ku-seg button,.ku-sw{appearance:none;-webkit-appearance:none;font:inherit;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--ink);cursor:pointer;background:none;border:1px solid rgba(233,228,216,.4);border-radius:0;min-height:2.1em;padding:.2em .4em .16em}
.ku-seg button{flex:1;margin-left:-1px}.ku-seg button:first-child{margin-left:0}
.ku-seg button:hover,.ku-sw:hover{border-color:var(--ink);position:relative}
.ku-seg button[aria-pressed=true]{background:var(--cy);border-color:var(--cy);color:#06201f;position:relative}
.ku-sw{grid-column:2 / 4;justify-self:start;display:flex;align-items:center;gap:.7em;padding:.2em .9em .16em .5em;min-width:6.4em}
.ku-sw i{width:1.9em;height:.9em;border:1px solid currentColor;position:relative}
.ku-sw i::after{content:"";position:absolute;left:2px;top:2px;bottom:2px;width:.7em;background:currentColor;transition:transform .12s}
.ku-sw[aria-checked=true]{color:var(--cy);border-color:var(--cy)}
.ku-sw[aria-checked=true] i::after{transform:translateX(calc(1.9em - .7em - 6px))}
.ku-card .ku-note{margin-top:1.1em!important}

/* debrief */
.ku-over{display:flex;align-items:flex-end;padding:var(--gv) var(--gr) calc(var(--gv) + .4em) var(--gl);opacity:0;transition:opacity .7s ease}
.ku-over.on{opacity:1}
.ku-o-scrim{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(var(--k),.86) 0,rgba(var(--k),.62) 30%,rgba(var(--k),0) 62%)}
.ku-deb{position:relative;width:min(33em,100%);text-shadow:var(--sh)}
.ku-deb>small{display:flex;align-items:center;gap:.7em;font-size:.9em;letter-spacing:.3em;color:var(--rd)}
.ku-deb>small::before{content:"";width:.6em;height:.6em;background:var(--rd)}
.ku-deb h2{display:flex;align-items:baseline;gap:.25em;margin-top:.25em!important;font-weight:700!important;line-height:.9}
.ku-deb h2 span{font-size:1.5em;letter-spacing:.24em}
.ku-deb h2 b{font-size:6.2em;font-weight:700;letter-spacing:.02em;line-height:.86}
.ku-deb h2 em{align-self:center;margin-left:1.1em;font-style:normal;font-size:.86em;letter-spacing:.22em;padding:.3em .7em .24em;background:var(--cy);color:#06201f;text-shadow:none}
.ku-cause{margin-top:.7em!important;font-size:.95em;letter-spacing:.12em;color:var(--dim);text-transform:none;font-weight:500}
.ku-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin-top:1.3em!important;border-top:1px solid var(--hair)}
.ku-stats div{padding:.75em .6em .65em 0;border-bottom:1px solid var(--hair)}
.ku-stats dt{font-size:.78em;letter-spacing:.2em;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-stats dd{font-size:1.75em;font-weight:700;letter-spacing:.04em;margin-top:.12em}
.ku-deb .ku-acts{margin-top:1.5em}

/* ------------------------------------------------------------------ rig bay */
.ku-bay{pointer-events:none}
.ku-b-p{pointer-events:auto;position:absolute;left:0;top:0;bottom:0;width:clamp(31em,38vw,47em);max-width:100%;display:flex;flex-direction:column;
  background:linear-gradient(90deg,rgba(8,11,15,.95),rgba(8,11,15,.88));border-right:1px solid var(--hair);box-shadow:1px 0 0 rgba(var(--k),.6)}
.ku-b-h{display:flex;align-items:flex-end;justify-content:space-between;gap:1em;padding:var(--gv) 1.4em .9em var(--gl);border-bottom:1px solid var(--hair)}
.ku-b-h small{display:block;font-size:.8em;letter-spacing:.26em;color:var(--cy);margin-bottom:.3em}
.ku-b-h h2{font-size:2.2em!important;font-weight:700!important;letter-spacing:.14em!important;line-height:.9}
.ku-b-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:.9em 1.4em 1em var(--gl);scrollbar-width:thin;scrollbar-color:var(--dim) transparent}
.ku-b-body h3{display:flex;align-items:baseline;gap:.8em;font-size:.78em!important;letter-spacing:.26em!important;color:var(--dim);margin:1.05em 0 .5em!important}
.ku-b-body h3 em{font-style:normal;color:var(--ink);letter-spacing:.14em}
.ku-b-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4em}
.ku-b-tab,.ku-b-ch,.ku-b-hpr,.ku-b-opt,.ku-b-pt{appearance:none;-webkit-appearance:none;font:inherit;letter-spacing:inherit;text-transform:inherit;color:var(--ink);background:rgba(var(--k),.45);border:1px solid rgba(233,228,216,.26);border-radius:0;cursor:pointer;text-align:left;margin:0}
.ku-b-tab:hover,.ku-b-ch:hover,.ku-b-hpr:hover,.ku-b-opt:hover{border-color:var(--ink)}
.ku-b-tab:focus-visible,.ku-b-ch:focus-visible,.ku-b-hpr:focus-visible,.ku-b-opt:focus-visible,.ku-b-pt:focus-visible,.ku-b-name input:focus-visible{outline:2px solid var(--am);outline-offset:2px;position:relative;z-index:1}
.ku-b-tab{display:flex;align-items:center;gap:.5em;min-width:0;padding:.5em .55em .44em;border-bottom-width:2px}
.ku-b-tab span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9em;letter-spacing:.07em}
.ku-b-tab em{display:none;font-style:normal;font-size:.68em;font-weight:700;letter-spacing:.14em;padding:.14em .4em .08em;background:var(--cy);color:#06201f}
.ku-b-tab.drop em{display:block}
.ku-b-tab[aria-selected=true]{border-color:var(--cy);background:rgba(73,224,210,.13)}
.ku-b-tab[aria-selected=true] kbd{background:var(--cy);border-color:var(--cy);color:#06201f}
.ku-b-tab.over{border-bottom-color:var(--rd)}
.ku-b-name{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:.9em;margin-top:.55em;font-size:.8em;letter-spacing:.2em;color:var(--dim)}
.ku-b-name input{font:inherit;font-size:1.2em;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ink);background:rgba(var(--k),.5);border:0;border-bottom:1px solid rgba(233,228,216,.4);border-radius:0;padding:.35em .5em .28em;min-width:0;width:100%;user-select:text;-webkit-user-select:text}
.ku-b-chs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4em}
.ku-b-ch{display:flex;flex-direction:column;padding:.55em .6em .6em;min-width:0}
.ku-b-ch strong{font-size:1.2em;font-weight:700;letter-spacing:.1em;line-height:1}
.ku-b-ch small{font-size:.74em;letter-spacing:.18em;color:var(--dim);margin:.2em 0 .5em}
.ku-b-ch[aria-checked=true]{border-color:var(--cy);background:rgba(73,224,210,.13);box-shadow:inset 0 2px 0 var(--cy)}
.ku-b-ch[aria-checked=true] small{color:var(--cy)}
.ku-b-sb{display:grid;grid-template-columns:3.9em minmax(0,1fr);align-items:center;gap:.4em;font-size:.7em;letter-spacing:.12em;color:var(--dim);line-height:1.38}
.ku-b-sb i{height:.34em;background:rgba(233,228,216,.16);overflow:hidden}
.ku-b-sb b{display:block;height:100%;background:var(--ink);transform-origin:0 50%}
.ku-b-ch[aria-checked=true] .ku-b-sb b{background:var(--cy)}
.ku-b-blurb{margin-top:.6em!important;font-size:.9em;letter-spacing:.05em;text-transform:none;font-weight:500;color:var(--dim);line-height:1.35}
.ku-b-blurb b{color:var(--ink);font-weight:600}
.ku-b-hps{display:flex;flex-direction:column;gap:.3em}
.ku-b-hpr{display:grid;grid-template-columns:8.4em minmax(0,1fr) auto 3.2em .8em;align-items:center;gap:.6em;width:100%;min-height:2.3em;padding:.3em .6em .26em;border-left:2px solid var(--cy)}
.ku-b-hp.empty .ku-b-hpr{border-left-color:rgba(233,228,216,.3)}
.ku-b-hpr .s{font-size:.78em;letter-spacing:.16em;color:var(--dim);white-space:nowrap}
.ku-b-hpr .m{font-weight:700;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.7}
.ku-b-hpr .m .ku-lock{color:var(--am);margin:0 .5em 0 .05em}
.ku-b-hp.empty .m{color:var(--dim);font-weight:600}
.ku-b-hpr .t,.ku-b-opt em{font-style:normal;text-align:right;font-size:.86em;color:var(--dim);white-space:nowrap}
.ku-b-hpr i{width:.5em;height:.5em;border-right:1.5px solid var(--dim);border-bottom:1.5px solid var(--dim);transform:rotate(45deg) translate(-.12em,-.12em)}
.ku-b-hp.open .ku-b-hpr{border-color:var(--ink);border-left-color:var(--cy);background:rgba(233,228,216,.08)}
.ku-b-hp.open .ku-b-hpr i{transform:rotate(-135deg) translate(-.12em,-.12em)}
.ku kbd.no{border-style:dashed;color:var(--dim);border-color:rgba(233,228,216,.35);font-weight:600}
.ku-b-opts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.25em;padding:.35em 0 .2em .9em;border-left:2px solid var(--cy);margin-top:.25em}
.ku-b-opt{display:flex;align-items:center;gap:.5em;min-width:0;min-height:2.1em;padding:.25em .5em .2em}
.ku-b-opt span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.92em;letter-spacing:.06em}
.ku-b-opt.cur{background:var(--cy);border-color:var(--cy);color:#06201f}
.ku-b-opt.cur em,.ku-b-opt.cur kbd{color:#06201f;border-color:rgba(6,32,31,.6);background:none}
.ku-b-opt.over:not(.cur) em{color:var(--rd)}
.ku-b-desc{grid-column:1 / -1;font-size:.88em;letter-spacing:.04em;text-transform:none;font-weight:500;color:var(--dim);line-height:1.35;min-height:2.7em;padding:.25em 0 .1em}
.ku-b-desc b{color:var(--ink);font-weight:600;text-transform:uppercase;letter-spacing:.1em;margin-right:.4em}
.ku-b-plate{grid-template-columns:8.4em minmax(0,1fr) 3.2em;min-height:2em}
.ku-b-plate span{font-size:.86em;color:var(--dim);white-space:nowrap}
.ku-b-ton{margin:0}
.ku-b-ton-h{display:flex;justify-content:space-between;align-items:baseline;font-size:.86em;letter-spacing:.16em;color:var(--dim)}
.ku-b-ton-h b{font-size:1.5em;font-weight:700;letter-spacing:.04em;color:var(--ink)}
.ku-b-ton-b{position:relative;height:.6em;margin-top:.3em;background:rgba(233,228,216,.14);overflow:hidden}
.ku-b-ton-b i{position:absolute;inset:0;background:var(--cy);transform-origin:0 50%;transition:transform .15s ease-out}
.ku-b-ton-b i.pl{background:var(--ink);transform-origin:0 50%}
.ku-b-ton-b u{position:absolute;left:83.33%;top:0;bottom:0;width:2px;background:var(--am);box-shadow:0 0 0 1px rgba(var(--k),.8)}
.ku-b-ton p{margin-top:.35em!important;font-size:.84em;letter-spacing:.06em;text-transform:none;font-weight:500;color:var(--dim)}
.ku-b-ton.over .ku-b-ton-h b,.ku-b-ton.over p{color:var(--rd)}
.ku-b-ton.over p{font-weight:700;text-transform:uppercase;letter-spacing:.14em}
.ku-b-ton.over .ku-b-ton-b i{background:var(--rd)}.ku-b-ton.over .ku-b-ton-b{box-shadow:0 0 0 1px var(--rd)}
.ku-b-pts{display:flex;flex-wrap:wrap;gap:.45em}
.ku-b-pt{display:flex;width:2.7em;height:1.9em;padding:2px;background:none}
.ku-b-pt i{flex:2;height:100%}.ku-b-pt i+i{flex:1}
.ku-b-pt[aria-checked=true]{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.ku-b-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:.55em!important;border-top:1px solid var(--hair)}
.ku-b-stats div{padding:.45em .4em 0 0}
.ku-b-stats dt{font-size:.74em;letter-spacing:.2em;color:var(--dim)}
.ku-b-stats dd{font-size:1.55em;font-weight:700;letter-spacing:.03em;white-space:nowrap}
.ku-b-stats dd small{font-size:.5em;font-weight:600;color:var(--dim);margin-left:.3em;letter-spacing:.1em}
.ku-b-grp{display:flex;flex-wrap:wrap;gap:.35em 1.1em;margin-top:.6em;font-size:.86em;letter-spacing:.08em}
.ku-b-grp span{display:flex;align-items:center;gap:.45em;white-space:nowrap}
.ku-b-f{padding:.7em 1.4em calc(var(--gv) - .2em) var(--gl);border-top:1px solid var(--hair);background:rgba(var(--k),.55)}
.ku-b-btns{display:flex;align-items:center;gap:.6em;margin-top:.7em}
.ku-b-btns .pri{flex:1;max-width:16em}
.ku-btn:disabled{background:rgba(255,75,58,.14);border-color:var(--rd);color:var(--rd);cursor:not-allowed;clip-path:none}
.ku-btn.done{background:rgba(73,224,210,.14);color:var(--cy);clip-path:none}
.ku-btn.done:hover{background:rgba(73,224,210,.24);color:var(--cy);border-color:var(--cy)}
.ku-b-saved{margin-left:auto;font-size:.76em;letter-spacing:.2em;color:var(--dim)}
.ku-b-saved.warn{color:var(--rd)}
.ku-b-cap{position:absolute;right:var(--gr);bottom:calc(var(--gv) + .4em);text-align:right;text-shadow:var(--sh)}
.ku-b-cap small{display:block;font-size:.78em;letter-spacing:.3em;color:var(--cy)}
.ku-b-cap b{display:block;font-size:1.9em;font-weight:700;letter-spacing:.12em;line-height:1.1}
.ku-b-cap span{font-size:.86em;letter-spacing:.16em}
@media (max-width:700px){
  .ku-b-p{width:100%;border-right:0;background:rgba(8,11,15,.93)}
  .ku-b-cap{display:none}
  .ku-b-hpr{grid-template-columns:6.6em minmax(0,1fr) auto 2.8em .8em;gap:.45em}
  .ku-b-h,.ku-b-body,.ku-b-f{padding-right:var(--gr)}
}
/* HUD additions (phase B) */
.ku-lo{display:flex;justify-content:center;gap:.4em;margin-top:.55em;font-size:.8em;letter-spacing:.1em}
.ku-lo span{display:flex;align-items:center;gap:.4em;padding:.1em .5em .06em .15em;background:rgba(var(--k),.5);color:var(--dim);white-space:nowrap;max-width:9em;overflow:hidden}
.ku-lo span.on{color:var(--ink);box-shadow:inset 0 -2px 0 var(--cy)}
.ku-lo span.on kbd{background:var(--cy);border-color:var(--cy);color:#06201f}
.ku-eq{display:flex;gap:1.1em;margin-top:.45em}
.ku-mini.shd .ku-bar i{background:var(--cy)}.ku-mini.shd.up{color:var(--cy)}.ku-mini.shd.low .ku-bar i{background:var(--am)}
.ku-mini.grp b{min-width:0;color:var(--ink)}.ku-mini.grp.live b{color:var(--cy)}
.ku-wps.many .ku-wp{width:9.3em}
.ku-bot.mech .ku-bc{display:none}
.ku-bot.mech{grid-template-columns:minmax(0,auto) minmax(0,1fr);grid-template-areas:"bl br"}
@media (max-width:760px){
  .ku-wps{flex-wrap:wrap}.ku-wps.many .ku-wp{width:auto;flex:1 1 30%}
  .ku-bot.mech{grid-template-columns:minmax(0,1fr);grid-template-areas:"br" "bl"}
  .ku-lo span:not(.on) em{display:none}
}

/* ------------------------------------------------------------------ phase C: operations, salvage, perks */
.ku-stage{display:flex;align-items:baseline;gap:.5em;white-space:nowrap;max-width:100%}
.ku-stage b{font-size:1.9em;font-weight:700;line-height:.9}
.ku-stage .sep{width:1px;height:1.35em;background:var(--hair);align-self:center;margin:0 .3em}
.ku-stage .t{font-size:1.1em;letter-spacing:.16em;overflow:hidden;text-overflow:ellipsis}
.ku-gauge{width:min(30em,100%)}
.ku-gauge .h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.25em;font-size:.84em;letter-spacing:.18em}
.ku-relay{width:min(18em,100%)}
.ku-relay .h b::after{content:"%";font-size:.8em;margin-left:.15em}
.ku-relay .ku-bar{height:.45em}
.ku-relay.low .h{color:var(--rd)}.ku-relay.low .ku-bar i{background:var(--rd)}.ku-relay.low .ku-bar{animation:ku-blink .8s steps(2,jump-none) infinite}
.ku-boss .h b{font-size:1.35em;font-weight:700;letter-spacing:.24em;color:var(--ink)}
.ku-boss .h span{color:var(--rd)}
.ku-boss .ku-bar{height:.7em;box-shadow:0 0 0 1px rgba(var(--k),.8),0 0 0 2px rgba(255,75,58,.55)}
.ku-boss .ku-bar i{background:var(--rd)}.ku-boss .ku-bar i.lag{background:var(--ink)}
.ku-boss .ku-bar u{background:linear-gradient(90deg,transparent calc(33.33% - 1px),rgba(var(--k),.95) calc(33.33% - 1px),rgba(var(--k),.95) calc(33.33% + 1px),transparent calc(33.33% + 1px),transparent calc(66.66% - 1px),rgba(var(--k),.95) calc(66.66% - 1px),rgba(var(--k),.95) calc(66.66% + 1px),transparent calc(66.66% + 1px))}
.ku-boss.rage .h span{animation:ku-blink .5s steps(2,jump-none) infinite}
.ku-obj{margin-top:1em;width:17em;max-width:calc(100vw - var(--gl) - var(--gr))}
.ku-obj>small{display:block;font-size:.76em;letter-spacing:.24em;color:var(--dim);margin-bottom:.35em}
.ku-ob{display:none;grid-template-columns:auto minmax(0,1fr) auto;gap:.6em;align-items:start;padding:.32em .6em .4em .5em;background:var(--plate);border-left:2px solid var(--ink);margin-bottom:.25em}
.ku-ob.on{display:grid}
.ku-ob>i{width:.55em;height:.55em;margin-top:.28em;border:1.5px solid var(--ink);transform:rotate(45deg)}
.ku-ob b{display:block;font-size:.95em;letter-spacing:.1em;line-height:1.2}
.ku-ob span{display:block;font-size:.8em;letter-spacing:.06em;color:var(--dim);text-transform:none;font-weight:500;margin-top:.1em}
.ku-ob .ku-bar{margin-top:.35em}.ku-ob .ku-bar i{background:var(--ink)}
.ku-ob em{font-style:normal;font-size:.95em;font-weight:700;letter-spacing:.06em;white-space:nowrap}
.ku-ob.def{border-color:var(--cy)}.ku-ob.def>i{border-color:var(--cy)}.ku-ob.def .ku-bar i{background:var(--cy)}
.ku-ob.done{border-color:var(--cy);opacity:.75}.ku-ob.done>i{background:var(--cy);border-color:var(--cy)}.ku-ob.done em{color:var(--cy)}.ku-ob.done .ku-bar i{background:var(--cy)}
.ku-ob.fail{border-color:var(--rd)}.ku-ob.fail em,.ku-ob.fail b{color:var(--rd)}.ku-ob.fail>i{border-color:var(--rd)}
.ku-mk.obj{color:var(--ink)}.ku-mk.obj.def{color:var(--cy)}.ku-mk.obj.bad{color:var(--rd)}
.ku-mk.obj .ic{transform:none;border-width:2px}
.ku-salv{display:flex;align-items:baseline;gap:.6em;margin-top:.2em;font-size:.84em;letter-spacing:.14em;color:var(--dim)}
.ku-salv em{font-style:normal;color:var(--ink)}
.ku-salv b{color:var(--am);font-weight:700;min-width:0}
.ku-salv b:empty{display:none}
.ku-pk{display:flex;flex-wrap:wrap;gap:.25em;margin-bottom:.5em}
.ku-pk i{font-style:normal;font-size:.72em;font-weight:700;letter-spacing:.04em;min-width:1.9em;padding:.16em .2em .1em;text-align:center;background:rgba(var(--k),.6);border:1px solid var(--cy);color:var(--cy);text-shadow:none}
.ku-perk{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(52em,calc(100% - var(--gl) - var(--gr)));text-align:center;pointer-events:auto;cursor:default;z-index:5}
.ku-perk::before{content:"";position:absolute;left:50%;top:50%;width:200vmax;height:200vmax;margin:-100vmax 0 0 -100vmax;background:rgba(var(--k),.45);z-index:-1;pointer-events:none}
.ku-perk>small{display:block;font-size:.84em;letter-spacing:.3em;color:var(--cy)}
.ku-perk h3{font-size:2em!important;font-weight:700!important;letter-spacing:.22em!important;margin:.1em 0 .7em!important}
.ku-perk-c{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7em}
.ku-perk-c button{appearance:none;-webkit-appearance:none;font:inherit;letter-spacing:inherit;text-transform:inherit;color:var(--ink);text-align:left;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:.55em;min-height:9.5em;padding:.85em .95em 1em;background:rgba(8,11,15,.96);border:1px solid rgba(233,228,216,.4);border-top:2px solid var(--cy);border-radius:0;text-shadow:none}
.ku-perk-c button:hover,.ku-perk-c button:focus-visible{border-color:var(--cy);background:rgba(10,36,36,.92);outline:none}
.ku-perk-c kbd{font-size:1.05em;min-width:2em;background:var(--cy);border-color:var(--cy);color:#06201f}
.ku-perk-c b{font-size:1.25em;font-weight:700;letter-spacing:.12em;line-height:1.1}
.ku-perk-c span{font-size:.95em;letter-spacing:.04em;text-transform:none;font-weight:500;color:#c9ccd1;line-height:1.35}
.ku-lo span.lk{opacity:.7}.ku-lo span.lk .ku-lock{color:var(--am);margin:0 0 0 .1em}
/* title: mode select */
.ku-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5em;margin-top:1.3em;max-width:38em;text-shadow:none}
.ku-mode{appearance:none;-webkit-appearance:none;font:inherit;letter-spacing:inherit;text-transform:inherit;color:var(--ink);text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:.3em;padding:.6em .8em .65em;background:rgba(var(--k),.55);border:1px solid rgba(233,228,216,.35);border-radius:0}
.ku-mode b{font-size:1.1em;font-weight:700;letter-spacing:.16em}
.ku-mode span{font-size:.84em;letter-spacing:.04em;text-transform:none;font-weight:500;color:var(--dim);line-height:1.3}
.ku-mode:hover{border-color:var(--ink)}
.ku-mode[aria-checked=true]{border-color:var(--cy);background:rgba(10,36,36,.8);box-shadow:inset 0 2px 0 var(--cy)}
.ku-mode[aria-checked=true] b{color:var(--cy)}
.ku-mode:focus-visible{outline:2px solid var(--am);outline-offset:3px}
.ku-t-row{margin-top:1em}
/* rig bay: locks */
.ku-lock{display:inline-block;width:.66em;height:.5em;background:currentColor;position:relative;margin:.3em .35em 0 0;vertical-align:baseline}
.ku-lock::before{content:"";position:absolute;left:.11em;right:.11em;bottom:100%;height:.3em;border:.1em solid currentColor;border-bottom:0;border-radius:.3em .3em 0 0}
.ku-b-lk{font-style:normal;color:var(--am);font-size:.86em;font-weight:700;letter-spacing:.06em;white-space:nowrap}
.ku-b-ch .ku-b-lk{position:absolute;right:.55em;top:.5em}
.ku-b-ch{position:relative}
.ku-b-ch.locked strong,.ku-b-ch.locked .ku-b-sb{opacity:.6}
.ku-b-tab.lock span{color:var(--dim)}
.ku-b-opt.lockd span{color:var(--dim)}.ku-b-opt.lockd.cur span{color:#06201f}
.ku-b-opt.cur .ku-b-lk{color:#06201f}
.ku-b-sal{margin-left:auto;margin-right:.4em;text-align:right}
.ku-b-sal span{display:block;font-size:.76em;letter-spacing:.22em;color:var(--dim)}
.ku-b-sal b{font-size:1.5em;font-weight:700;letter-spacing:.04em;color:var(--am)}
.ku-btn.unlock{background:var(--am);border-color:var(--am);color:#1a1206}
.ku-btn.unlock:hover{background:#fff;border-color:#fff}
/* debrief: victory */
.ku-over.won .ku-deb>small{color:var(--cy)}.ku-over.won .ku-deb>small::before{background:var(--cy)}
.ku-over.won .ku-deb h2 b{font-size:4.6em;letter-spacing:.08em}
.ku-over.won .ku-deb h2 span{display:none}
.ku-stats{grid-template-columns:repeat(4,minmax(0,1fr))}
.ku-stats dd.am{color:var(--am)}
@media (max-width:760px){
  .ku-perk-c{grid-template-columns:minmax(0,1fr)}.ku-perk-c button{min-height:0;flex-direction:row;flex-wrap:wrap;align-items:center;gap:.4em .7em;padding:.7em .8em}
  .ku-perk-c span{flex-basis:100%}
  .ku-perk h3{font-size:1.5em!important;margin-bottom:.5em!important}
  .ku-over.won .ku-deb h2 b{font-size:3.4em}
  .ku-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ku-modes{margin-top:1em}
  .ku-hud .ku-top{width:calc(100% - var(--gl) - var(--gr));min-width:0;gap:.45em}
  .ku-top>.ku-wave,.ku-top>.ku-stage{max-width:calc(100% - 17.5em);min-height:10.6em}
  .ku-stage{flex-wrap:wrap;justify-content:center;align-content:flex-start;row-gap:.2em}
  .ku-stage .sep{display:none}.ku-stage .t{flex-basis:100%;white-space:normal;text-align:center;font-size:.95em;line-height:1.2}
  .ku-top>.ku-obj,.ku-top>.ku-tips{width:100%;max-width:none;margin-top:0}
  .ku-top>.ku-obj>small{display:none}
  .ku-top>.ku-tips{text-align:left}
  .ku-ob{padding:.25em .6em .3em .5em}.ku-ob span{display:none!important}
  .ku-gauge,.ku-relay{width:100%}
}

/* ------------------------------------------------------------------ phase D: co-op */
.ku-lobby{pointer-events:none}
.ku-l-p{width:clamp(30em,36vw,42em)}
.ku-l-lead{font-size:.95em;letter-spacing:.06em;text-transform:none;font-weight:500;color:var(--dim)}
.ku-l-txt{font-size:.95em;letter-spacing:.05em;text-transform:none;font-weight:500;color:#c9ccd1;line-height:1.45;margin-top:.5em!important}
.ku-l-txt a{color:var(--cy);font-weight:700;font-size:1.25em;letter-spacing:.06em;text-decoration:underline;text-underline-offset:.2em;pointer-events:auto;cursor:pointer;user-select:text;-webkit-user-select:text}
.ku-l-txt a:focus-visible{outline:2px solid var(--am);outline-offset:3px}
.ku-l-sec h3:first-child{margin-top:1.2em!important}
.ku-l-sec[data-l=unavail] h3{font-size:1.5em!important;letter-spacing:.12em!important;color:var(--am);line-height:1.15}
.ku-l-name{margin-top:1.1em}
.ku-l-join{display:flex;gap:.5em}
.ku-l-join input,.ku-l-code b{font:inherit;font-weight:700;letter-spacing:.34em;text-transform:uppercase;color:var(--ink)}
.ku-l-join input{width:7.2em;font-size:1.5em;text-align:center;background:rgba(var(--k),.5);border:1px solid rgba(233,228,216,.4);border-radius:0;padding:.2em 0 .14em .34em;user-select:text;-webkit-user-select:text}
.ku-l-join input::placeholder{color:rgba(233,228,216,.28)}
.ku-l-join input:focus-visible{outline:2px solid var(--am);outline-offset:2px}
.ku-l-err{min-height:1.3em;margin-top:.8em!important;font-size:.9em;letter-spacing:.08em;color:var(--rd);text-transform:none;font-weight:600}
.ku-l-err:empty{min-height:0;margin:0!important}
.ku-l-code{display:flex;align-items:center;gap:1em}
.ku-l-code b{font-size:4.6em;line-height:.95;color:var(--cy);margin-right:-.2em;user-select:all;-webkit-user-select:all}
.ku-l-list{display:flex;flex-direction:column;gap:.25em}
.ku-l-row{display:flex;align-items:center;gap:.6em;min-height:2.3em;padding:.3em .7em .26em .5em;background:rgba(var(--k),.45);border:1px solid rgba(233,228,216,.22);border-left:2px solid var(--cy)}
.ku-l-row i{font-style:normal;font-size:.8em;color:var(--dim);min-width:1em}
.ku-l-row b{font-weight:700;letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-l-row em{font-style:normal;font-size:.7em;font-weight:700;letter-spacing:.14em;padding:.14em .4em .08em;border:1px solid var(--dim);color:var(--dim)}
.ku-l-row em.host{background:var(--am);border-color:var(--am);color:#1a1206}
.ku-l-row span{margin-left:auto;font-size:.84em;letter-spacing:.08em;color:var(--dim);white-space:nowrap}
.ku-l-row.you{border-color:rgba(73,224,210,.5);border-left-color:var(--cy);background:rgba(73,224,210,.1)}
.ku-l-row.empty{border-left-color:rgba(233,228,216,.2);border-style:dashed}.ku-l-row.empty b{color:rgba(233,228,216,.32);font-weight:600}
.ku-l-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4em}
.ku-l-wait{color:var(--am)!important;letter-spacing:.2em!important;text-transform:uppercase!important;font-weight:700!important;margin-top:1.2em!important}
.ku-l-wait::after{content:"";display:inline-block;width:1.2em;text-align:left;animation:ku-dots 1.2s steps(4,jump-none) infinite}
@keyframes ku-dots{0%{content:""}33%{content:"."}66%{content:".."}100%{content:"..."}}
.ku-team{margin-top:1em;width:13.5em;display:flex;flex-direction:column;gap:.25em}
.ku-tm{display:none;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.15em .5em;padding:.3em .55em .36em .5em;background:var(--plate);border-left:2px solid var(--cy)}
.ku-tm.on{display:grid}
.ku-tm>i{width:.5em;height:.5em;border-radius:50%;background:var(--cy)}
.ku-tm.rig>i{border-radius:0;transform:rotate(45deg);width:.6em;height:.6em}
.ku-tm b{font-size:.9em;letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-tm em{font-style:normal;font-size:.8em;letter-spacing:.08em;color:var(--dim);white-space:nowrap}
.ku-tm .ku-bar{grid-column:1 / -1}
.ku-tm.down{border-color:var(--rd)}.ku-tm.down>i{background:var(--rd)}.ku-tm.down em{color:var(--rd);font-weight:700;animation:ku-blink .7s steps(2,jump-none) infinite}
.ku-mk.mate .ic{width:.7em;height:.7em;left:-.35em;top:-.35em;border-width:1.5px}
.ku-mk.mate .ic::after{inset:.12em}
.ku-mk.mate .tx{top:.7em;font-size:.8em}
.ku-net{display:flex;gap:.7em;align-items:center;margin-top:.25em;font-size:.8em;letter-spacing:.14em;color:var(--dim)}
.ku-net em{font-style:normal;font-weight:700;padding:.08em .4em .02em;background:var(--am);color:#1a1206;text-shadow:none}
.ku-rev{position:absolute;left:50%;top:66%;transform:translateX(-50%);width:16em;max-width:calc(100% - var(--gl) - var(--gr));padding:.4em .7em .5em;background:var(--plate);border-left:2px solid var(--cy)}
.ku-rev span{display:flex;align-items:center;gap:.6em;margin-bottom:.4em;white-space:nowrap}
.ku-rev kbd{border-color:var(--cy);color:var(--cy)}
.ku-rev b{overflow:hidden;text-overflow:ellipsis}
.ku-spec{position:absolute;left:50%;top:62%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.35em;padding:.6em 1.2em .6em;background:rgba(40,6,4,.74);border:1px solid var(--rd);text-align:center;max-width:calc(100% - var(--gl) - var(--gr))}
.ku-spec b{font-size:1.7em;font-weight:700;letter-spacing:.24em;color:#fff;margin-right:-.24em}
.ku-spec span{font-size:.9em;letter-spacing:.06em;text-transform:none;font-weight:500}
.ku-spec em{font-style:normal;display:flex;align-items:center;gap:.5em;font-size:.9em;letter-spacing:.14em;margin-top:.15em}
.ku-pause.soft{background:rgba(var(--k),.3)}
.ku-deploy{display:grid;place-items:center;cursor:pointer;background:radial-gradient(ellipse at 50% 50%,rgba(var(--k),.62) 0,rgba(var(--k),.3) 55%,rgba(var(--k),.5) 100%);text-shadow:var(--sh);z-index:20}
.ku-deploy>div{display:flex;flex-direction:column;align-items:center;gap:.5em;padding:1.6em 3em 1.5em;border-top:2px solid var(--cy);border-bottom:1px solid var(--hair);background:rgba(8,11,15,.72);text-align:center;max-width:calc(100% - var(--gl) - var(--gr))}
.ku-deploy small{font-size:.84em;letter-spacing:.3em;color:var(--cy)}
.ku-deploy b{font-size:5em;font-weight:700;letter-spacing:.22em;margin-right:-.22em;line-height:1}
.ku-deploy span{font-size:1.35em;letter-spacing:.24em;color:var(--cy);animation:ku-blink 1s steps(2,jump-none) infinite}
.ku-deploy em{font-style:normal;display:flex;align-items:center;gap:.5em;font-size:.84em;letter-spacing:.16em;color:var(--dim);margin-top:.5em}
.ku-deploy:focus-visible>div{outline:2px solid var(--am);outline-offset:4px}
.ku-deb .ku-l-wait{margin-top:1em!important}
@media (max-width:760px){.ku-deploy b{font-size:3.2em}.ku-deploy>div{padding:1.2em 1.4em}.ku-deploy span{font-size:1.05em;letter-spacing:.16em}}
@media (max-width:700px){.ku-l-p{width:100%}.ku-l-code b{font-size:3.6em}}
@media (max-width:760px){.ku-top>.ku-team{width:100%;flex-direction:row}.ku-top>.ku-team .ku-tm{flex:1;min-width:0;padding:.22em .4em .3em}.ku-tm em{font-size:.72em}.ku-spec{top:58%}}

/* ------------------------------------------------------------------ motion */
@keyframes ku-blink{0%{opacity:1}100%{opacity:.35}}
@keyframes ku-pulse{0%,100%{transform:rotate(45deg) scale(1)}50%{transform:rotate(45deg) scale(1.3)}}
@keyframes ku-rdy{0%,100%{box-shadow:0 0 0 1px rgba(4,6,9,.7),0 0 1.2em rgba(73,224,210,.25)}50%{box-shadow:0 0 0 1px rgba(4,6,9,.7),0 0 2.2em rgba(73,224,210,.7)}}
@keyframes ku-in{0%{opacity:0;transform:translateY(-.5em)}100%{opacity:1;transform:none}}
@keyframes ku-inr{0%{opacity:0;transform:translateX(.8em)}100%{opacity:1;transform:none}}
@keyframes ku-ban{0%{opacity:0;transform:scale(1.12);letter-spacing:.2em}9%{opacity:1;transform:none}82%{opacity:1}100%{opacity:0;transform:translateY(-.4em)}}

/* ------------------------------------------------------------------ small frames */
@media (max-width:900px){
  .ku-title{grid-template-columns:minmax(0,1fr);grid-template-areas:"top" "." "main" "ref";row-gap:1.4em}
  .ku-t-scrim{background:linear-gradient(0deg,rgba(var(--k),.9) 0,rgba(var(--k),.7) 40%,rgba(var(--k),0) 78%),linear-gradient(180deg,rgba(var(--k),.4) 0,rgba(var(--k),0) 16%)}
  .ku-logo{width:min(100%,560px)}
  .ku-ref{grid-template-columns:1fr 1fr;gap:0 1.4em}
  .ku-cols{grid-template-columns:minmax(0,1fr)}
  .ku-hints{display:none}
  .ku-top{width:calc(100% - var(--gl) - var(--gr) - 20em)}
}
@media (max-width:760px){
  .ku-bot{grid-template-columns:minmax(0,1fr);grid-template-areas:"bc" "br" "bl"}
  .ku-bl{width:100%}.ku-br{justify-self:stretch;align-items:stretch}.ku-bc{width:min(21em,100%)}
  .ku-wp{flex:1;width:auto;padding:.4em .45em .45em}
  .ku-tl,.ku-radar{width:8.4em}.ku-radar{height:8.4em}
  .ku-feed div:nth-child(n+3){display:none}
  .ku-score b{font-size:1.5em}
  .ku-top{width:calc(100% - var(--gl) - var(--gr) - 17.5em);min-width:7em}
  .ku-wv-r .hide-s{display:none}
  .ku-wave .ku-bar{width:8em}
  .ku-ban b{font-size:2em}.ku-ban span::before,.ku-ban span::after{width:1.2em}
  .ku-toast{position:relative;min-width:0;width:max-content;max-width:calc(100vw - var(--gl) - var(--gr))}
  .ku-prompt{top:57%}
  .ku-over{align-items:flex-end}
  .ku-o-scrim{background:linear-gradient(0deg,rgba(var(--k),.9) 0,rgba(var(--k),.7) 48%,rgba(var(--k),0) 80%)}
  .ku-deb h2 b{font-size:4.6em}
  .ku-pitch{font-size:1.05em;letter-spacing:.14em}
  .ku-t-top span:last-child{display:none}
  .ku-card{padding:1.1em 1.1em 1em}
  .ku-row{grid-template-columns:8.2em minmax(0,1fr) 3.2em;gap:.6em}
}
@media (max-width:760px) and (max-height:560px),(max-height:440px){
  .ku-t-ref,.ku-tips,.ku-feed{display:none!important}
  .ku-stats{grid-template-columns:repeat(6,minmax(0,1fr))}
}
@media (prefers-reduced-motion:reduce){
  .ku *,.ku *::before,.ku *::after{animation-duration:.001s!important;animation-iteration-count:1!important;transition-duration:.001s!important}
  .ku-ban.on{animation:none}
}
`;
