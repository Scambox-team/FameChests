// Kolory konfetti dla wariantów
export const VARIANT_COLORS: Record<string, string[]> = {

      diamond: ["#e8fbff", "#9ff6ff", "#c9b8ff", "#ffffff"], emerald: ["#00c853", "#6dffb0", "#c6ffe0", "#ffffff"],
      ruby: ["#ff1744", "#ff8a9c", "#ffd0d8", "#ffffff"], amethyst: ["#9b3dff", "#c99bff", "#ecdcff", "#ffffff"],
      sapphire: ["#1c46d8", "#5a86ff", "#a8c0ff", "#ffffff"], blackdiamond: ["#0a0a0e", "#6a6a7c", "#c8c8d8", "#ffffff"], steel: ["#d2d9df", "#8c969f", "#3e464d"], clear: ["#ffffff", "#e0f7ff", "#bfefff"],
      negative: ["#000000", "#ffffff", "#7a7a7a", "#00e5ff"], gold: ["#ffc531", "#fff3b0", "#fff"], holo: ["#9ff6ff", "#ff9ff3", "#fff"],
      silver: ["#e6ebf2", "#b8c2d0", "#ffffff"], platinum: ["#ffffff", "#e6ebff", "#c8cede", "#f1eeff"], bronze: ["#cd7f32", "#f0b27a", "#ffe0c0"], pearl: ["#ffffff", "#ffd1e4", "#d3fff1", "#d3e2ff"],
      pixel: ["#3a5bd0", "#ffffff", "#7dff5a", "#ffe13b"], glass: ["#2f7fc0", "#3fa0a0", "#6a5aa8", "#e8a33a", "#ffffff"],
      neon: ["#ff3df0", "#3de0ff", "#ffe63c", "#ffffff"], thermal: ["#2a0a6a", "#d8303a", "#f07a1a", "#ffd23f", "#fffbe8"],
      blueprint: ["#1f3a7a", "#e8f4ff", "#4a8ad8"], glitch: ["#ff2b5a", "#00e5ff", "#ffffff", "#7a2bff"], mosaic: ["#c91a09", "#f2cd37", "#0055bf", "#237841"],
      popart: ["#ffe100", "#e8202f", "#ff4fa0", "#2fd0ff", "#7cff4a"], noir: ["#e8e8e8", "#2a2a2a", "#ffffff"],
      slime: ["#7dff3a", "#c6ff6c", "#3fbf1a"], matte: ["#2a2a2a", "#5c5c5c", "#111"], racing: ["#c8202f", "#f2e6cf", "#161210"],
      bismuth: ["#ff4fb5", "#ffd23f", "#3fe0ff", "#7a5cff"], digital: ["#3dff6e", "#0f6a26", "#eaffea"], cyber: ["#ff2bd6", "#00e5ff", "#fcee0a"],
      fade: ["#f9e45b", "#f7a23b", "#f05ba5", "#a86bf0", "#5aa8f5"], wanted: ["#f2e2b8", "#b8955a", "#2a1608"], artdeco: ["#d4af37", "#fff3c4", "#0a0908"],
      cheese: ["#ffd34a", "#ffe680", "#b88512"], aero: ["#4cc2ff", "#ffffff", "#7ef03a", "#ffd23f"],
      honey: ["#ffd75e", "#f2a20f", "#b86a08"],
      chinese: ["#d81e1e", "#e2b13c", "#fff2b0"], moro: ["#4a4f2e", "#6a5a3a", "#1c1f14", "#a89a6a"], beer: ["#f7bf3a", "#fffdf6", "#cf7a0c"],
      electric: ["#9fdcff", "#ffffff", "#4fb8ff"],
      synthwave: ["#ff2bd6", "#00e5ff", "#ffe14a", "#6a1fb8"], motor: ["#e8202f", "#f2f2f2", "#1b1b1b"],
      chocolate: ["#6b3a1f", "#d4a12a", "#ffe6c8", "#3a1a08"], candy: ["#ff5aa8", "#3ddc84", "#ffffff", "#ffd23f", "#4fb8ff"], hollywood: ["#ffd08a", "#e0683a", "#8a3a5a", "#1a2048"], cobalt: ["#3ab0ff", "#bfe6ff", "#1e4fd8", "#ffffff"], banana: ["#ffe14a", "#9ab82a", "#7a5414", "#fff6b0"],
      chesswhite: ["#fbf6ea", "#d8ccb0", "#1b1712"], chessblack: ["#1b1712", "#5a5040", "#fbf6ea"], covid: ["#e8101e", "#ffd21a", "#120304"], rgb: ["#ff004c", "#ffe600", "#2bff6a", "#00d9ff", "#6a5cff", "#ff00e6"], tabloid: ["#d40d1c", "#ffd400", "#111111", "#f1eee6"], anime: ["#ff7a00", "#ffd21a", "#1f6bff", "#ffffff"], claude: ["#e88a55", "#f1e9db", "#1a1614"], scratch: ["#ffd21a", "#7a2ae0", "#c8ccd4"], teletext: ["#ffff00", "#00ffff", "#ff00ff", "#00ff00"], retroos: ["#008080", "#c0c0c0", "#000080"], receipt: ["#ffffff", "#d8d4cc", "#1a1a1a"], tarot: ["#e8c8ff", "#ffe8a8", "#6a2aa8"], muertos: ["#ff2f92", "#ffb81a", "#19d3c5", "#8a3dff", "#ff7a00"], uranium: ["#5dff1f", "#b6ff5a", "#d8ff8a"], mercury: ["#ffffff", "#c8d0d8", "#6a7480"], californium: ["#ffffff", "#dfe6f2", "#9aa2b0"], files: ["#e2c88a", "#b8201a", "#f8f4ea"], copper: ["#e8945a", "#c87533", "#5ab89e", "#8fd8c0"], reflective: ["#e6ff2a", "#d8dde2", "#ffffff"], usa: ["#f2f2f2", "#141414", "#8a8a8a"], apollo: ["#f2d27a", "#c8ccd4", "#f4f6f9"], komuna: ["#d4161f", "#111111", "#f6d77a"],
      vintage: ["#efe4cb", "#b8913d", "#6b4c22"], marble: ["#ffffff", "#d9d4c8", "#d4af37"], toxic: ["#5dff1f", "#b6ff3a", "#ffd400", "#0c1407"], reverse: ["#c9d6ff", "#ffffff", "#9ff6ff"], bw: ["#ffffff", "#111111", "#888888"],
      rzulty: ["#ffe600", "#fff6a0", "#ffffff"], flag: ["#ffffff", "#dc143c", "#ffcf3f"], halloween: ["#ff7a00", "#1a0a12", "#8a2be2", "#ffd84a"],
      lantern: ["#ffb347", "#ff7a00", "#fff1c1", "#3a1a06"], devil: ["#ff1a1a", "#b3001b", "#ffcf5a", "#120002"],
      sketch: ["#1b1712", "#f4ecd8", "#6b5d4a"], galaxy: ["#7b4dff", "#1fb6ff", "#ff4fd8", "#ffffff"],
      mlg: ["#9cff00", "#ffe100", "#ff7a00", "#ff2bd6", "#00e5ff"],
    
};
