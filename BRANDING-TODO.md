# JAIS Command Ops — Branding TODO

## ✅ Completed
- All "Mission Control" strings replaced with "JAIS Command Ops" across src/
- layout.tsx metadata title updated: `Mission Control` → `JAIS Command Ops`
- Apple web app title updated

## 🎨 Logo / Favicon — Manual Steps Required

The app uses Next.js App Router. To add JAIS branding assets:

1. **Favicon**: Place `favicon.ico` at `src/app/favicon.ico`
   - Next.js App Router auto-discovers this file
   - Recommended size: 32x32 or 64x64

2. **Apple touch icon**: Place `apple-touch-icon.png` at `src/app/apple-icon.png`
   - Recommended size: 180x180

3. **Open Graph image**: Place `og-image.png` at `src/app/opengraph-image.png`
   - Recommended size: 1200x630

4. **Logo in UI**: Check `src/components/layout/header-bar.tsx` and `src/components/layout/nav-rail.tsx`
   - Replace any text/generic icon with JAIS logo SVG or PNG

## 📂 Asset Placement
```
src/app/
  favicon.ico          ← browser tab icon
  apple-icon.png       ← iOS home screen icon
  opengraph-image.png  ← social share preview
```

No `public/` directory exists in this repo — all static assets go under `src/app/`.

## 🖼️ Suggested Design
- Primary color: Deep navy (#0F172A) or JAIS brand color
- Logo mark: "JAIS" wordmark or shield icon
- Tagline: "AI Solutions for the Modern Enterprise"
