const { withMainActivity } = require('expo/config-plugins');

// Config plugin: inject an onSaveInstanceState logger into the generated Kotlin
// MainActivity so you can watch the Android saved-state parcel size (and confirm
// android:support:fragments is present) as the react-native-screens native stack
// deepens.  Observe with: adb logcat -s RNSRepro
//
// (android/ is CNG-generated, so this must be a config plugin rather than a
// hand-edit of MainActivity.kt.)
const LOGGER = `
  override fun onSaveInstanceState(outState: android.os.Bundle) {
      super.onSaveInstanceState(outState)
      val p = android.os.Parcel.obtain()
      p.writeBundle(outState)
      val total = p.dataSize()
      p.recycle()
      val reg = outState.getBundle("androidx.lifecycle.BundlableSavedStateRegistry.key")
      val hasFrag = reg?.containsKey("android:support:fragments") ?: false
      android.util.Log.e("RNSRepro", "onSaveInstanceState parcel=" + total + " bytes | regHasFragments=" + hasFrag)
  }
`;

module.exports = (config) =>
  withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') return config;
    if (config.modResults.contents.includes('override fun onSaveInstanceState')) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /class MainActivity : ReactActivity\(\) \{/,
      (match) => `${match}\n${LOGGER}`,
    );
    return config;
  });
