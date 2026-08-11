# rns-4487-repro

Reproduction aid for **software-mansion/react-native-screens#4487**.

Under the New Architecture, react-native-screens mounts one native `Fragment`
per pushed screen. On a deep push stack they accumulate in the host Activity's
saved state, and when the app is backgrounded `onSaveInstanceState` serialises a
parcel that — in a real app — exceeds the Binder transaction budget →
`android.os.TransactionTooLargeException` on `activityStopped`.

This is a **save-time** crash, distinct from the restore-time crashes RNS already
handles (`AutoRemovingFragment` / `RNScreensFragmentFactory` / `super.onCreate(null)`):
the oversized parcel is rejected by the Binder at save time, before any restore.

## What this repo demonstrates (and what it does not)

This minimal app **demonstrates the accumulation mechanism** — it auto-pushes a
native-stack screen to `TARGET_DEPTH` and logs, on background, the saved-state
parcel size and that the react-native-screens fragment payload is present:

```
adb logcat -s RNSRepro
E RNSRepro: onSaveInstanceState parcel=<N> bytes | regHasFragments=true
```

It **does not, by itself, cross the ~1 MB Binder limit and crash.** That is
expected and worth stating plainly: with *trivial* screens the saved state per
fragment is tiny (~75 bytes/fragment measured on API 34), so a toy stack stays
far under the limit. The production crash is an **emergent property of real
screens × deep navigation** — real screens save materially more per fragment
(see the numbers below), and long sessions reach 100+ retained fragments.

The point of this repo is to show the **code path** (RNS mounts one saved
Fragment per screen; they land under `androidx.lifecycle.BundlableSavedStateRegistry.key`
→ `android:support:fragments`; `regHasFragments=true`) and to let you watch that
parcel grow with depth. The crash-scale evidence is the production data below.

## Production crash evidence

Real Sentry / `TooLargeTool` breakdown from a shipping app on this exact stack
(the parcel that actually crashed at `activityStopped`, ~639 KB):

```
androidx.lifecycle.BundlableSavedStateRegistry.key [637 KB]
    android:support:activity-result [208 KB]
    android:support:fragments      [428 KB]   <- ~150 ScreenStackFragment/ScreenFragment entries
        fragment_<uuid> [2868]
            childFragmentManager [2176]
                fragment_<uuid> [1752]
                    childFragmentManager [1068]
        ... (x150)
```

- Device: Samsung Galaxy A57 (SM-A576B), Android 16, 7.8 GB RAM — **not** low-memory.
- Each real fragment contributes ~2.8 KB (mostly FragmentManager metadata + the
  nested `childFragmentManager`); at 150+ retained fragments this is 428 KB.

## Environment

- react-native-screens **4.18.0**
- react-native **0.81.5**, New Architecture **ON** (Fabric)
- Expo SDK 54, `@react-navigation/native-stack` v7 (RNS `ScreenStack` consumer)
- androidx.fragment **1.8.9**
- Android (arm64), Android 13+ emulator or device

## Run

```bash
npm install
npx expo prebuild --platform android --clean   # New Arch is enabled via app.json;
                                                # the parcel logger is injected by
                                                # plugins/with-parcel-logger.js
npx expo run:android
```

1. The app auto-pushes a self-referential screen to `TARGET_DEPTH` (`App.tsx`).
2. In a second terminal: `adb logcat -s RNSRepro`.
3. When auto-push settles, enable Developer Options → **"Don't keep activities"**
   (forces the save+stop deterministically on an emulator; production hits it via
   natural memory pressure), then press **Home**.
4. `RNSRepro` logs the saved-state parcel size and `regHasFragments=true`. Raise
   `TARGET_DEPTH` (or run against real, content-heavy screens) to see it climb.

## App-side workaround (fix vector)

Stripping the fragment state in `onSaveInstanceState` stops the crash — RNS
rebuilds the stack from JS on restore. **Gotcha:** on androidx.fragment 1.8.x the
`FragmentManager` state is saved via `SavedStateRegistry`, so the classic top-level
`outState.remove("android:support:fragments")` is a **no-op** (measured: 0 bytes
removed). It must be reached inside the registry bundle:

```kotlin
override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.getBundle("androidx.lifecycle.BundlableSavedStateRegistry.key")
        ?.remove("android:support:fragments")
}
```

This depends on internal androidx key strings, which is why a first-party RNS
option to bound its own saved state would be preferable — see the issue.
