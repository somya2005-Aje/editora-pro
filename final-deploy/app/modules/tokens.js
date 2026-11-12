/* Editora Pro — design tokens for JS (Phase 0+1)
   Mirrors the CSS custom properties in app.css / photo.css (FOUNDATION.md
   §2). JS that needs a size, breakpoint or colour reads it here instead
   of hard-coding a second copy. Classic script; load before app.js. */
(function(){
"use strict";
window.EPTokens={
  fontUI:'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
  fs:{xs:11, sm:12, md:13, base:14, lg:15, h2:18, h1:26},
  sp:{1:4, 2:6, 3:8, 4:12, 5:16, 6:24},
  radius:{sm:6, md:8, lg:12, xl:16},
  btnH:{sm:26, md:32, lg:40},
  icon:{sm:16, md:20, lg:24},
  layout:{sidebarW:212, toolPanelW:300, inspectorW:290, bottomNavH:56},
  breakpoint:{mobile:900, compact:1280},
  color:{
    dark:{bg:"#14161a",bg2:"#1d1f24",panel:"#23262c",panel2:"#191c21",line:"#33373f",txt:"#f2f3f5",mut:"#9aa0ab",acc:"#00c8d7"},
    light:{bg:"#eef1f6",bg2:"#ffffff",panel:"#ffffff",panel2:"#f1f4fa",line:"#cbd3e0",txt:"#141a33",mut:"#55608a",acc:"#0891b2"},
    ok:"#22c55e", warn:"#f59e0b", err:"#f43f5e", info:"#22d3ee"
  },
  isMobile:function(){return typeof window!=="undefined"&&window.innerWidth<=900;}
};
})();
