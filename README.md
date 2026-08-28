# rns-4487-repro

Reproduction for **software-mansion/react-native-screens#4487** — under the New
Architecture (Fabric), retained `ScreenStackFragment`s accumulate in the host
Activity's `onSaveInstanceState` parcel and, on a deep/wide navigation tree,
exceed the Binder transaction limit → `android.os.TransactionTooLargeException`
on `activityStopped`.

## What this repo demonstrates

Set `MODE` at the top of `App.tsx` and background the app. It logs the saved-state
parcel size from an injected `onSaveInstanceState` logger:

```
adb logcat -s RNSRepro
E RNSRepro: onSaveInstanceState parcel=<N> bytes | regHasFragments=true
```

| `MODE` | structure | parcel vs depth (measured, Android 16) |
|---|---|---|
| `opaque` | plain push stack | **FLAT** — 3952 B at depth 3 **and** 100 |
| `transparentModal` | opaque root + `transparentModal` stack | **LINEAR** — 8152 / 31952 / 59952 B at depth 3 / 20 / 40 |
| `nested` | Root Stack → Bottom-Tabs → per-tab Stacks (one double-nested) + `formSheet` | 3952 (baseline) → 7176 (nested) → 8576 (nested + sheet) |

### Why `opaque` is flat (and the original repro was wrong)

For an **opaque** top screen, `ScreenStack.kt` sets `visibleBottom == null` and
`transaction.remove()`s every fragment except the top one. A *removed* fragment is
not serialised into `onSaveInstanceState`, so the parcel is constant regardless of
depth — the N screens live in react-navigation's JS state, not as N saved
fragments. A plain push stack therefore does **not** leak.

### Why the other modes accumulate

Fragments only accumulate when they stay `add()`-ed. RNS keeps them added for
**translucent** presentations — `Screen.isTranslucent()` is true for
`TRANSPARENT_MODAL` and `FORM_SHEET` — and for **nested navigators** (bottom-tabs
keeps every visited tab's stack mounted; each mounted navigator contributes a
retained fragment with its own `childFragmentManager`). RNS declares these
fragments non-restorable (`AutoRemovingFragment`, `super.onCreate(null)`) and
rebuilds from JS on restore — yet still lets their state be **saved**, which is
the dead weight that overflows the parcel.

`transparentModal` fits `parcel = 3952 + 1400·depth` (R² = 1) — ≈1.4 KB per
retained fragment with trivial screens. Real screens save materially more
(≈2.8 KB/fragment in the app where this crashed in production), so a wide/deep
tree of ≈150 retained fragments reaches ≈428 KB of `android:support:fragments`
(≈639 KB total) — over the Binder limit.

## Run

```bash
npm install
npx expo prebuild --platform android --clean   # injects the onSaveInstanceState
                                                # logger via plugins/with-parcel-logger.js
npx expo run:android
```

1. Set `MODE` in `App.tsx` and reload.
2. In a second terminal: `adb logcat -s RNSRepro`.
3. When the app settles, enable Developer Options → **"Don't keep activities"**,
   then press **Home** to background it (forces the save+stop deterministically;
   production hits it via natural memory pressure / app switch).
4. Read the parcel size. Switch `MODE` (and `TARGET_DEPTH`) to compare.

> Note: `transparentModal` and `nested` composite many layers, so a **software
> (swiftshader) emulator** stalls past ~depth 40–50; that is an emulator limit,
> not RNS. Use a hardware-accelerated emulator or a real device to go deeper.

## Environment

- react-native-screens **4.18.0**
- react-native **0.81.5**, New Architecture **ON** (Fabric)
- Expo SDK 54, `@react-navigation/native-stack` v7 + `@react-navigation/bottom-tabs` v7
- androidx.fragment **1.8.9**
- Android 13+ (measured on Android 16, emulator + real device)

## App-side workaround (and the gotcha)

Stripping the fragment state in `MainActivity.onSaveInstanceState` stops the crash —
RNS rebuilds from JS. On androidx.fragment 1.8.x the `FragmentManager` state is
saved via `SavedStateRegistry`, so the classic top-level
`outState.remove("android:support:fragments")` is a **no-op**; it must be reached
inside the registry bundle:

```kotlin
override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.getBundle("androidx.lifecycle.BundlableSavedStateRegistry.key")
        ?.remove("android:support:fragments")
}
```

This depends on internal androidx key strings, which is why a first-party RNS
option to bound its own saved state would be preferable — see the issue.
