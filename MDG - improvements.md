# Mark Down Gonzo - improvements

Print functionality

fonts

- sans-serif
  - delete Righteous
  - delete nova mono
  - add Inter
  - add Geist
  - add Futura
  - add OpenDyslexic
  - add Andika
- monospace
  - add Geist Mono
  - add Cascadia Code
  - add OpenDyslexic Mono

Themes:  
It should have an alternate theme which is the ultimate mimicry of Microsoft word - Ribbon View.



```

[1] Devplex >> cd ~/Devplex/MarkDownGonzo/markdowngonzo && npm run tauri build

> markdowngonzo@0.1.0 tauri
> tauri build

        Info Looking up installed tauri packages to check mismatched versions...
     Running beforeBuildCommand `npm run build`

> markdowngonzo@0.1.0 build
> tsc && vite build

vite v8.2.2 building client environment for production...
✓ 1966 modules transformed.
computing gzip size...
dist/index.html                                 0.44 kB │ gzip:   0.28 kB
dist/assets/jost-q-RKOgPK.woff2                 9.40 kB
dist/assets/geist-mono-DTRLJnHl.woff2           9.86 kB
dist/assets/roboto-mono-GekRknry.woff2         12.68 kB
dist/assets/markdowngonzo-logo-H24CXB3w.png    14.58 kB
dist/assets/space-mono-Rg4St2Dn.woff2          16.52 kB
dist/assets/montserrat-BLhwKU8k.woff2          18.78 kB
dist/assets/baumans-BTPwFrDf.woff2             18.94 kB
dist/assets/andika-BTFTIZb-.woff2              19.20 kB
dist/assets/roboto-BqEyEoaF.woff2              21.88 kB
dist/assets/inter-C38fXH4l.woff2               23.66 kB
dist/assets/cascadia-code-hfeVgAEz.woff2       29.45 kB
dist/assets/opendyslexic-mono-BHe2Nt9S.woff2   32.51 kB
dist/assets/geist-gapTbOY8.woff2               33.40 kB
dist/assets/opendyslexic-nUhe5EwG.woff2       115.28 kB
dist/assets/index-CExW9Gwc.css                 32.31 kB │ gzip:   7.19 kB
dist/assets/w3c-keyname-BOAvb0qz.js             1.48 kB │ gzip:   0.81 kB
dist/assets/index-B1MhIaFh.js                 274.56 kB │ gzip:  82.83 kB
dist/assets/RawEditor-C_95Uvmm.js             606.28 kB │ gzip: 207.36 kB
dist/assets/VisualEditor-BS29Lati.js          704.94 kB │ gzip: 221.81 kB

✓ built in 609ms
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
   Compiling markdowngonzo v0.1.0 (/home/gonzo/Devplex/MarkDownGonzo/markdowngonzo/src-tauri)
    Finished `release` profile [optimized] target(s) in 54.90s
       Built application at: /home/gonzo/Devplex/MarkDownGonzo/markdowngonzo/src-tauri/target/release/markdowngonzo
        Info Patching /home/gonzo/Devplex/MarkDownGonzo/markdowngonzo/src-tauri/target/release/markdowngonzo with bundle type information: appimage
    Bundling MarkDownGonzo_0.1.0_amd64.AppImage (/home/gonzo/Devplex/MarkDownGonzo/markdowngonzo/src-tauri/target/release/bundle/appimage/MarkDownGonzo_0.1.0_amd64.AppImage)
failed to bundle project: `failed to run linuxdeploy`
       Error failed to bundle project: `failed to run linuxdeploy`
[1] markdowngonzo b.c1dfaa1 >> ~/Devplex/MarkDownGonzo/markdowngonzo/src-tauri/target/release/markdowngonzo

(markdowngonzo:1572414): Gdk-WARNING **: 12:20:27.620: Tried to map a popup with a non-top most parent
```



&nbsp;