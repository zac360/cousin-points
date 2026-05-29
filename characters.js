// ============================================================
// CHARACTER ART — replace drawCharacter() to swap in real PNGs
// All characters drawn as simple flat SVG shapes.
// drawCharacter(type, color, tier, size) → SVG string
// tier: 'council' | 'noble' | 'common' | 'peasant'
// ============================================================

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : { r: 100, g: 100, b: 200 };
}

function darkenHex(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const d = (v) => Math.max(0, Math.floor(v * (1 - amt)));
  return '#' + [d(r), d(g), d(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function lightenHex(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const l = (v) => Math.min(255, Math.floor(v + (255 - v) * amt));
  return '#' + [l(r), l(g), l(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function tierOverlaySVG(tier) {
  if (tier === 'council') return `
    <rect x="26" y="6" width="28" height="5" rx="2" fill="#B8860B"/>
    <polygon points="27,11 27,6 32,2 37,7 40,1 43,7 48,2 53,6 53,11" fill="#FFD700" stroke="#B8860B" stroke-width="0.5"/>
    <rect x="71" y="24" width="3" height="38" rx="1" fill="#C9A84C"/>
    <circle cx="72" cy="22" r="6" fill="#FFD700"/>
    <circle cx="72" cy="22" r="4" fill="#9B59B6"/>
    <circle cx="72" cy="22" r="2" fill="#FFD700"/>
  `;
  if (tier === 'noble') return `
    <path d="M 46,15 Q 58,-2 68,4 Q 62,12 52,13 Z" fill="white" opacity="0.85"/>
    <path d="M 45,16 Q 56,0 62,5 Q 57,13 48,14 Z" fill="#e74c3c" opacity="0.8"/>
    <ellipse cx="19" cy="40" rx="9" ry="6" fill="#7f8c8d" opacity="0.9"/>
    <ellipse cx="61" cy="40" rx="9" ry="6" fill="#7f8c8d" opacity="0.9"/>
  `;
  if (tier === 'peasant') return `
    <line x1="74" y1="44" x2="70" y2="90" stroke="#6B3A2A" stroke-width="4" stroke-linecap="round"/>
    <path d="M 70,46 Q 80,38 74,48" fill="none" stroke="#6B3A2A" stroke-width="3"/>
    <polygon points="22,72 19,80 24,79" fill="#3d2b1f" opacity="0.6"/>
    <polygon points="55,74 58,82 53,80" fill="#3d2b1f" opacity="0.6"/>
    <line x1="28" y1="76" x2="33" y2="80" stroke="#3d2b1f" stroke-width="2" opacity="0.7"/>
    <line x1="47" y1="77" x2="52" y2="81" stroke="#3d2b1f" stroke-width="2" opacity="0.7"/>
  `;
  return ''; // common — no overlay
}

function knightSVG(c, dark, light) {
  return `
    <rect x="27" y="68" width="11" height="20" rx="3" fill="${dark}"/>
    <rect x="42" y="68" width="11" height="20" rx="3" fill="${dark}"/>
    <rect x="24" y="83" width="15" height="6" rx="3" fill="#2d1b0e"/>
    <rect x="41" y="83" width="15" height="6" rx="3" fill="#2d1b0e"/>
    <rect x="20" y="36" width="40" height="34" rx="5" fill="${c}"/>
    <rect x="27" y="39" width="26" height="18" rx="3" fill="${dark}"/>
    <rect x="38" y="39" width="4" height="18" fill="${light}" opacity="0.3"/>
    <rect x="27" y="53" width="26" height="4" fill="${light}" opacity="0.2"/>
    <ellipse cx="19" cy="38" rx="7" ry="5" fill="${dark}"/>
    <ellipse cx="61" cy="38" rx="7" ry="5" fill="${dark}"/>
    <rect x="8" y="36" width="13" height="24" rx="4" fill="${c}"/>
    <rect x="59" y="36" width="13" height="24" rx="4" fill="${c}"/>
    <rect x="7" y="56" width="15" height="7" rx="3" fill="${dark}"/>
    <rect x="58" y="56" width="15" height="7" rx="3" fill="${dark}"/>
    <path d="M 1,44 Q 0,36 5,36 L 12,36 L 12,62 L 5,64 Q 0,61 1,54 Z" fill="${dark}"/>
    <circle cx="6" cy="50" r="4" fill="${c}" opacity="0.7"/>
    <line x1="6" y1="43" x2="6" y2="57" stroke="${c}" stroke-width="1.5" opacity="0.5"/>
    <line x1="3" y1="50" x2="9" y2="50" stroke="${c}" stroke-width="1.5" opacity="0.5"/>
    <rect x="68" y="28" width="3" height="30" rx="1" fill="#c0c8d0"/>
    <rect x="64" y="43" width="11" height="3" rx="1" fill="#888"/>
    <rect x="69" y="26" width="3" height="7" rx="1" fill="#6b3a2a"/>
    <ellipse cx="40" cy="21" rx="13" ry="14" fill="${dark}"/>
    <rect x="30" y="17" width="20" height="10" rx="2" fill="#111827"/>
    <rect x="31" y="20" width="7" height="3" rx="1" fill="#60e0ff" opacity="0.8"/>
    <rect x="42" y="20" width="7" height="3" rx="1" fill="#60e0ff" opacity="0.8"/>
  `;
}

function mageSVG(c, dark, light) {
  const skin = '#f5cba0';
  return `
    <polygon points="22,72 58,72 62,90 18,90" rx="4" fill="${c}"/>
    <rect x="27" y="68" width="12" height="10" fill="${dark}"/>
    <rect x="41" y="68" width="12" height="10" fill="${dark}"/>
    <polygon points="40,2 20,24 60,24" fill="${c}"/>
    <ellipse cx="40" cy="24" rx="18" ry="5" fill="${dark}"/>
    <polygon points="40,4 22,24 58,24" fill="${c}"/>
    <circle cx="60" cy="24" rx="3" fill="${light}" opacity="0.5"/>
    <circle cx="25" cy="50" r="2" fill="#FFD700" opacity="0.7"/>
    <circle cx="55" cy="60" r="2" fill="#FFD700" opacity="0.7"/>
    <circle cx="35" cy="68" r="1.5" fill="#FFD700" opacity="0.7"/>
    <circle cx="50" cy="45" r="1.5" fill="#FFD700" opacity="0.6"/>
    <circle cx="40" cy="28" r="12" fill="${skin}"/>
    <circle cx="35" cy="27" r="2" fill="#3d2b1f"/>
    <circle cx="45" cy="27" r="2" fill="#3d2b1f"/>
    <path d="M 36,33 Q 40,36 44,33" fill="none" stroke="#3d2b1f" stroke-width="1.5" stroke-linecap="round"/>
    <rect x="10" y="36" width="10" height="28" rx="4" fill="${c}"/>
    <circle cx="15" cy="37" r="4" fill="${skin}"/>
    <rect x="60" y="36" width="10" height="28" rx="4" fill="${c}"/>
    <rect x="70" y="28" width="3" height="50" rx="1" fill="${dark}"/>
    <circle cx="71" cy="25" r="7" fill="${light}" opacity="0.9"/>
    <circle cx="71" cy="25" r="4" fill="#a78bfa"/>
    <circle cx="71" cy="25" r="2" fill="white" opacity="0.8"/>
  `;
}

function rogueSVG(c, dark, light) {
  const skin = '#f5cba0';
  return `
    <rect x="27" y="66" width="11" height="22" rx="3" fill="${dark}"/>
    <rect x="42" y="66" width="11" height="22" rx="3" fill="${dark}"/>
    <rect x="24" y="82" width="14" height="6" rx="3" fill="#1a0a05"/>
    <rect x="42" y="82" width="14" height="6" rx="3" fill="#1a0a05"/>
    <rect x="22" y="36" width="36" height="32" rx="4" fill="${c}"/>
    <rect x="32" y="58" width="16" height="4" rx="2" fill="${dark}"/>
    <circle cx="40" cy="60" r="3" fill="${light}"/>
    <circle cx="32" cy="60" r="2" fill="#888" opacity="0.8"/>
    <circle cx="48" cy="60" r="2" fill="#888" opacity="0.8"/>
    <rect x="8" y="36" width="15" height="20" rx="4" fill="${c}"/>
    <rect x="57" y="36" width="15" height="20" rx="4" fill="${c}"/>
    <rect x="7" y="48" width="5" height="18" rx="2" fill="#b0b8c0"/>
    <rect x="5" y="46" width="9" height="4" rx="1" fill="#6b5a3a"/>
    <rect x="68" y="48" width="5" height="18" rx="2" fill="#b0b8c0"/>
    <rect x="66" y="46" width="9" height="4" rx="1" fill="#6b5a3a"/>
    <circle cx="40" cy="21" rx="14" fill="#1a1a1a" opacity="0.9"/>
    <circle cx="40" cy="21" rx="14" fill="${dark}" opacity="0.85"/>
    <circle cx="40" cy="24" r="11" fill="${dark}"/>
    <circle cx="40" cy="27" r="9" fill="${c}" opacity="0.4"/>
    <circle cx="40" cy="25" r="9" fill="${skin}"/>
    <rect x="28" y="17" width="24" height="9" rx="1" fill="${dark}" opacity="0.85"/>
    <circle cx="35" cy="23" r="2.5" fill="#1a1a1a"/>
    <circle cx="45" cy="23" r="2.5" fill="#1a1a1a"/>
    <circle cx="35.5" cy="22.5" r="1" fill="white" opacity="0.7"/>
    <circle cx="45.5" cy="22.5" r="1" fill="white" opacity="0.7"/>
    <rect x="28" y="30" width="6" height="4" rx="1" fill="${dark}" opacity="0.7"/>
    <rect x="46" y="30" width="6" height="4" rx="1" fill="${dark}" opacity="0.7"/>
  `;
}

function bardSVG(c, dark, light) {
  const skin = '#f5cba0';
  return `
    <rect x="26" y="68" width="11" height="20" rx="3" fill="${dark}"/>
    <rect x="43" y="68" width="11" height="20" rx="3" fill="${dark}"/>
    <rect x="23" y="82" width="14" height="6" rx="3" fill="#2d1b0e"/>
    <rect x="43" y="82" width="14" height="6" rx="3" fill="#2d1b0e"/>
    <rect x="22" y="38" width="36" height="30" rx="4" fill="${c}"/>
    <rect x="22" y="44" width="36" height="5" fill="${light}" opacity="0.4"/>
    <rect x="22" y="55" width="36" height="5" fill="${dark}" opacity="0.4"/>
    <rect x="22" y="62" width="36" height="3" fill="${light}" opacity="0.3"/>
    <rect x="8" y="38" width="15" height="22" rx="4" fill="${c}"/>
    <rect x="57" y="38" width="15" height="22" rx="4" fill="${c}"/>
    <ellipse cx="65" cy="64" rx="10" ry="13" fill="#8B4513"/>
    <rect x="61" y="38" width="4" height="28" rx="2" fill="#6B3010"/>
    <ellipse cx="65" cy="64" rx="7" ry="9" fill="#A0522D"/>
    <line x1="63" y1="52" x2="63" y2="76" stroke="#DEB887" stroke-width="0.8"/>
    <line x1="65" y1="52" x2="65" y2="76" stroke="#DEB887" stroke-width="0.8"/>
    <line x1="67" y1="52" x2="67" y2="76" stroke="#DEB887" stroke-width="0.8"/>
    <circle cx="40" cy="26" r="12" fill="${skin}"/>
    <circle cx="35" cy="25" r="2" fill="#3d2b1f"/>
    <circle cx="45" cy="25" r="2" fill="#3d2b1f"/>
    <path d="M 36,31 Q 40,35 44,31" fill="none" stroke="#3d2b1f" stroke-width="1.5" stroke-linecap="round"/>
    <ellipse cx="40" cy="17" rx="20" ry="5" fill="${dark}"/>
    <rect x="28" y="8" width="24" height="11" rx="4" fill="${c}"/>
    <ellipse cx="40" cy="8" rx="12" ry="4" fill="${dark}"/>
    <path d="M 50,10 Q 62,-4 70,0 Q 64,8 55,10 Z" fill="white" opacity="0.9"/>
    <path d="M 50,11 Q 60,-2 66,2 Q 60,9 52,11 Z" fill="${light}" opacity="0.8"/>
  `;
}

function drawCharacter(type, color, tier, size) {
  const dark = darkenHex(color, 0.35);
  const light = lightenHex(color, 0.4);
  const w = size;
  const h = Math.round(size * 1.2);
  const vbW = 80;
  const vbH = 96;

  let baseShapes = '';
  switch (type) {
    case 'knight': baseShapes = knightSVG(color, dark, light); break;
    case 'mage':   baseShapes = mageSVG(color, dark, light); break;
    case 'rogue':  baseShapes = rogueSVG(color, dark, light); break;
    case 'bard':   baseShapes = bardSVG(color, dark, light); break;
    default:       baseShapes = knightSVG(color, dark, light);
  }

  const overlay = tierOverlaySVG(tier);

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
    ${baseShapes}
    ${overlay}
  </svg>`;
}
